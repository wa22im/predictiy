import { NextResponse } from "next/server";
import { requireAuth, GuardError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/v1/admin/competitions/[id]/matches/[matchId]
 *
 * Remove a match from a custom tournament. Refuses if the match has
 * already been played (kickoffTime has passed OR status is
 * FINISHED) — settled bets cannot be retroactively detached from a
 * competition without breaking the UserBet.settledBy link. The 400
 * response uses the error code `MATCH_ALREADY_PLAYED` so the UI can
 * render a precise error.
 *
 * Editor check (creator-only edit round): the caller must be in
 * `Competition.details.editors`. The list is initialised at
 * tournament creation with `[createdBy]`; non-editors get 403
 * `NOT_EDITOR`. The check runs AFTER the 404 (missing competition)
 * gate and BEFORE the match-existence + match-already-played
 * lookup, so a non-editor can't probe whether a match exists.
 *
 * Implementation: delete the CompetitionMatch join row. The Match
 * itself is NOT touched (matches can be in many competitions via the
 * join table; we only remove the link to THIS competition).
 *
 * Idempotency: a second DELETE on the same (matchId, competitionId)
 * pair returns 200 `{ removed: false }` — the join row is already
 * gone. This is consistent with the soft-delete idempotency
 * convention used elsewhere in the admin API.
 *
 * Auth: `requireAuth()` (any logged-in user) + editor check.
 * 401 on unauthenticated, 403 on not-an-editor, 404 on missing
 * competition, 404 on missing match, 400 on match-already-played.
 */

async function handleGuardError(e: unknown) {
  if (e instanceof GuardError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; matchId: string }> },
) {
  let caller: { id: string; email: string };
  try {
    caller = await requireAuth();
  } catch (e) {
    return handleGuardError(e);
  }

  const { id, matchId } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }
  if (!matchId) {
    return NextResponse.json({ error: "MISSING_MATCH_ID" }, { status: 400 });
  }

  // Look up the competition for the editor check (and the 404 on
  // missing/soft-deleted competition). The check is the same shape
  // as the POST endpoint: `editors?.includes(caller.id) ?? false`.
  const competition = await prisma.competition.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, details: true },
  });
  if (!competition || competition.deletedAt) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const editors = Array.isArray(
    (competition.details as { editors?: unknown } | null)?.editors,
  )
    ? ((competition.details as { editors: string[] }).editors)
    : [];
  if (!editors.includes(caller.id)) {
    return NextResponse.json({ error: "NOT_EDITOR" }, { status: 403 });
  }

  // Load the match to check kickoffTime + status. We need both fields
  // to enforce the "not already played" rule.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, kickoffTime: true, status: true },
  });
  if (!match) {
    return NextResponse.json({ error: "MATCH_NOT_FOUND" }, { status: 404 });
  }

  const now = new Date();
  // The match is "already played" if either:
  //   - kickoffTime has passed (regardless of status — a match whose
  //     status hasn't transitioned to FINISHED yet but whose kickoff
  //     is in the past is in-flight; we treat it as played for this
  //     gate's purposes), OR
  //   - status is explicitly FINISHED.
  // This matches the principal's intent: once a match is in the books,
  // it can no longer be detached from a competition.
  if (match.kickoffTime.getTime() <= now.getTime() || match.status === "FINISHED") {
    return NextResponse.json(
      {
        error: "MATCH_ALREADY_PLAYED",
        message: "Cannot remove a match that has already been played.",
      },
      { status: 400 },
    );
  }

  // Delete the join row. We use deleteMany (not delete) so a missing
  // row is a silent no-op (count = 0 → removed: false) rather than
  // throwing P2025. The composite PK is (matchId, competitionId).
  const result = await prisma.competitionMatch.deleteMany({
    where: { matchId, competitionId: id },
  });

  return NextResponse.json({ removed: result.count > 0 }, { status: 200 });
}
