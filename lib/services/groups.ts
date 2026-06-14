/**
 * Group-level service helpers.
 *
 * Why these live in a single file (vs. scattered across actions /
 * route handlers):
 *   - The `renameGroup` permission check is non-trivial (it reads
 *     JSONB, not a typed column) and is shared between the rename
 *     server action and the future group-detail PATCH endpoint.
 *     Keeping it in one place avoids drift.
 *   - The `classifyGroupArchive` function is the canonical
 *     "is this group still active?" predicate. Both the dashboard
 *     filter and the /groups page sort call it — having a single
 *     implementation means a change to the grace-period rule is a
 *     one-line edit.
 *
 * The `createdBy` permission field lives in `Group.details.createdBy`
 * (JSONB) instead of a typed `Group.createdBy` column because:
 *   - Backward compatible: existing groups have no `createdBy`
 *     (acceptable; the principal can backfill manually in the DB
 *     if a legacy group really needs to be renamed).
 *   - No schema migration: this stays a JSONB-only addition, which
 *     is the principal's preferred path for now.
 *   - Small and rarely queried: one user id per group, read only at
 *     rename time.
 *   - Forward compatible: future group-level metadata (per-group
 *     roles, ban lists, etc.) can also live in `details` without
 *     schema changes.
 *
 * The `endDateWithGrace` field (Competition.details) is the same
 * pattern: typed columns stay the source of truth, and the JSONB
 * carries derived/extended values that the typed schema doesn't yet
 * know about.
 */

import "server-only";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export type RenameGroupResult =
  | { ok: true; group: { id: string; name: string } }
  | { ok: false; error: string; status: number };

/**
 * Rename a group. Only the original creator (per
 * `group.details.createdBy`) can rename. Admin override is NOT
 * performed here — admins must edit the group via the admin tool
 * if a non-creator rename is needed.
 *
 * Returns a discriminated union so callers can map error codes to
 * HTTP status without re-throwing. The set of error codes is
 * intentionally small: callers can use the `status` field directly.
 */
export async function renameGroup(opts: {
  groupId: string;
  callerId: string;
  newName: string;
}): Promise<RenameGroupResult> {
  const group = await prisma.group.findUnique({
    where: { id: opts.groupId },
    select: { id: true, name: true, details: true },
  });
  if (!group) return { ok: false, error: "GROUP_NOT_FOUND", status: 404 };

  // Read the creator from details.createdBy (JSONB), not a typed
  // column. Legacy groups (created before this change) have no
  // createdBy and cannot be renamed until a creator is assigned.
  const details = (group.details as Record<string, unknown> | null) ?? {};
  const createdBy = typeof details.createdBy === "string" ? details.createdBy : null;
  if (createdBy === null) {
    return { ok: false, error: "LEGACY_GROUP_NO_CREATOR", status: 403 };
  }
  if (createdBy !== opts.callerId) {
    return { ok: false, error: "FORBIDDEN_ONLY_CREATOR_CAN_RENAME", status: 403 };
  }

  const trimmed = opts.newName.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    return { ok: false, error: "INVALID_NAME_LENGTH", status: 400 };
  }
  const updated = await prisma.group.update({
    where: { id: opts.groupId },
    data: { name: trimmed },
    select: { id: true, name: true },
  });
  revalidatePath(`/groups/${opts.groupId}`);
  revalidatePath("/groups");
  return { ok: true, group: updated };
}

export type LeaveGroupInput = {
  groupId: string;
  callerId: string;
};

export type LeaveGroupResult =
  | { ok: true; deletedGroup: boolean }
  | { ok: false; error: "NOT_A_MEMBER" };

/**
 * Remove the caller from a group. Any member may leave.
 *
 * After removing the GroupMember row, we check if any members remain.
 * If the group is now empty it is hard-deleted (cascade on the schema
 * removes the associated UserBet rows). The groupDelete is issued from
 * the service so that UserBet rows are torn down together with the
 * Group — leaving an empty group alive would just produce a ghost
 * leaderboard with no players.
 *
 * Returns a discriminated union so the server action can map the
 * error code to a UI message without re-throwing. The `deletedGroup`
 * flag is informational — the client uses it to decide whether to
 * redirect to the dashboard (group is gone) or to a different group.
 */
export async function leaveGroup(input: LeaveGroupInput): Promise<LeaveGroupResult> {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: input.callerId, groupId: input.groupId } },
    select: { id: true },
  });
  if (!membership) return { ok: false, error: "NOT_A_MEMBER" };

  await prisma.groupMember.delete({ where: { id: membership.id } });

  const remaining = await prisma.groupMember.count({
    where: { groupId: input.groupId },
  });
  if (remaining === 0) {
    await prisma.group.delete({ where: { id: input.groupId } });
    return { ok: true, deletedGroup: true };
  }
  return { ok: true, deletedGroup: false };
}

export type GroupArchiveStatus = "manual" | "active" | "archived";

/**
 * Classify a group's archive status based on its competition's
 * endDate, with a 7-day grace period for recently-ended tournaments.
 *
 * - "manual"   - no competition linked
 * - "active"   - competition linked, tournament not yet ended (or null endDate)
 * - "archived" - competition linked, tournament ended more than 7 days ago
 *
 * The grace period (`details.endDateWithGrace` = endDate + 7 days) is
 * a backward-compat field added in round 7. When present, it's used
 * INSTEAD of the typed `endDate` column. When absent, falls back to
 * the typed column.
 */
export function classifyGroupArchive(
  competition: { endDate: Date | null; details?: unknown } | null,
  now: Date = new Date(),
): GroupArchiveStatus {
  if (!competition) return "manual";

  // Prefer details.endDateWithGrace (the grace period). If absent,
  // fall back to the typed endDate column.
  const details = (competition.details as Record<string, unknown> | null) ?? {};
  const grace = typeof details.endDateWithGrace === "string" ? details.endDateWithGrace : null;

  if (grace !== null) {
    const graceDate = new Date(grace);
    if (!isNaN(graceDate.getTime())) {
      if (graceDate.getTime() <= now.getTime()) return "archived";
      return "active";
    }
    // Grace string was malformed — fall through to typed endDate.
  }

  return classifyWithEndDate(competition.endDate, now);
}

function classifyWithEndDate(endDate: Date | null, now: Date): GroupArchiveStatus {
  if (endDate === null) return "active";
  if (endDate.getTime() <= now.getTime()) return "archived";
  return "active";
}
