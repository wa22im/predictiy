import { NextResponse } from "next/server";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import {
  syncFootballDataCompetition,
  SyncError,
} from "@/lib/services/sync-football-data-competition";
import { checkSyncCooldown } from "@/lib/services/sync-cooldown";

/**
 * POST /api/v1/admin/competitions/[id]/sync
 *
 * Idempotent sync of a football-data.org competition. Fetches the
 * latest matches from the provider and upserts them into the DB.
 * Re-runs are safe: matches are upserted by `apiMatchId`, markets
 * are upserted on `(matchId, type, title)`, and auto-settle only
 * fires on status *transitions* to FINISHED.
 *
 * Cooldown guard (see lib/services/sync-cooldown.ts + isc-cooldown.md):
 *   - Reads `Competition.lastSyncedAt` and counts the not-yet-started
 *     upcoming matches.
 *   - If the competition has upcoming matches AND the last successful
 *     sync was < 5 min ago, returns 429 with `Retry-After` (seconds)
 *     and `{ retryAfterMs }` in the JSON body.
 *   - If there are no upcoming matches the cooldown is skipped — the
 *     admin may retry immediately for manual data fixes.
 *
 * Note on the cron: the 1-hour cron at `/api/v1/cron/sync` calls
 * `syncFootballDataCompetition` directly, bypassing this route, so
 * the per-competition cooldown does NOT throttle the cron's
 * schedule.
 *
 * Path param `id` is the Competition row's id (UUID).
 *
 * Returns 200 with the sync result on success. 404 if the
 * competition id is unknown, 400 if the competition is not linked
 * to football-data, 401/403 on guard failure, 429 on cooldown,
 * 500 on unexpected error.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof GuardError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  // Cooldown check: 5 min between syncs for the same competition,
  // but only if it has upcoming not-yet-started matches. Live (GOING)
  // and FINISHED matches are excluded — live games are covered by
  // the per-match `scoreLastSyncedAt` guard on the refresh endpoint,
  // and finished matches need no sync.
  const cooldownInfo = await prisma.competition.findUnique({
    where: { id },
    select: {
      lastSyncedAt: true,
      _count: {
        select: {
          matches: {
            where: {
              status: { in: ["SCHEDULED", "GOING"] },
              kickoffTime: { gt: new Date() },
            },
          },
        },
      },
    },
  });
  if (!cooldownInfo) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const decision = checkSyncCooldown({
    lastSyncedAt: cooldownInfo.lastSyncedAt,
    hasUpcomingMatches: cooldownInfo._count.matches > 0,
    now: new Date(),
  });

  if (!decision.allowed) {
    const retryAfterSec = Math.ceil((decision.retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      {
        error: decision.reason,
        retryAfterMs: decision.retryAfterMs,
        message: `Sync rate-limited. Try again in ${retryAfterSec}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  try {
    const result = await syncFootballDataCompetition(id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SyncError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "SYNC_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
