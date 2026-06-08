/**
 * Sync a football-data.org competition with the latest data from the
 * provider.
 *
 * The sync is the "Sync now" button on `/admin/leagues`. It is the
 * incremental counterpart to `onboardCompetition`:
 *   - onboard runs once when the admin adds a new competition; it
 *     refuses to run if the API returns 0 matches.
 *   - sync runs many times afterwards as new rounds become available
 *     (e.g. WC 2026 knockout stage); it tolerates 0 matches and
 *     treats it as a successful no-op (with a clear "no new matches"
 *     message in the UI).
 *
 * Flow:
 *   1. Load the Competition row. 404 if missing.
 *   2. Verify `externalSource === "football-data"`. 400 otherwise
 *      (e.g. an api-football competition; the legacy cron covers
 *      those).
 *   3. Resolve the football-data code from `externalLeagueId` and
 *      the season year from `externalSeason`.
 *   4. Fetch the latest matches via `getCompetitionMatches`.
 *   5. Apply the matches via the shared `applyFootballDataMatches`
 *      helper (which upserts + creates markets + auto-settles on
 *      transitions to FINISHED).
 *   6. Stamp `Competition.lastSyncedAt = new Date()` AFTER the apply
 *      succeeds. If the apply throws, the timestamp is NOT updated —
 *      the admin can see the sync is stale.
 *
 * Idempotency:
 *   - Step 5 is fully idempotent (upserts on `apiMatchId` and
 *     `(matchId, type, title)`).
 *   - Auto-settle is transition-aware: re-syncing a match that is
 *     already FINISHED does NOT re-settle its markets.
 *   - A sync that fetches 0 matches returns successfully with all
 *     counts at 0. The `lastSyncedAt` stamp is still updated so the
 *     admin knows the sync ran.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { getCompetitionMatches } from "@/lib/services/football-data";
import { applyFootballDataMatches } from "@/lib/services/apply-football-data-matches";

export type SyncResult = {
  /** Number of fixtures the API returned for the requested season. */
  fetched: number;
  createdMatches: number;
  updatedMatches: number;
  createdMarkets: number;
  updatedMarkets: number;
  settledMarkets: number;
  totalMatches: number;
  errors: { apiMatchId?: string; message: string }[];
};

export class SyncError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SyncError";
  }
}

export async function syncFootballDataCompetition(
  competitionId: string,
): Promise<SyncResult> {
  if (!competitionId) {
    throw new SyncError(400, "competitionId is required");
  }

  // 1. Load the Competition row.
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    select: {
      id: true,
      name: true,
      externalSource: true,
      externalLeagueId: true,
      externalSeason: true,
    },
  });
  if (!competition) {
    throw new SyncError(404, `Competition ${competitionId} not found`);
  }

  // 2. Route guard: this sync only knows how to talk to football-data.
  if (competition.externalSource !== "football-data") {
    throw new SyncError(
      400,
      `Competition "${competition.name}" is not linked to football-data ` +
        `(externalSource="${competition.externalSource ?? "null"}"). This sync ` +
        `endpoint is for football-data competitions only. The legacy ` +
        `api-football pipeline has its own sync.`,
    );
  }

  // 3. Resolve the provider's code + season.
  const code = competition.externalLeagueId;
  const season = competition.externalSeason;
  if (!code || season === null || season === undefined) {
    throw new SyncError(
      400,
      `Competition "${competition.name}" is missing externalLeagueId or ` +
        `externalSeason. Re-onboard the competition to fix this.`,
    );
  }

  // 4. Fetch the latest matches from the provider.
  const matches = await getCompetitionMatches(code, { season });

  // 5. Apply the matches. Tolerate per-match failures — they're
  //    captured in `result.errors` and the sync continues.
  const applyResult = await applyFootballDataMatches(competition.id, matches, {
    autoSettle: true,
  });

  // 6. Stamp lastSyncedAt. We only update it on success — if the
  //    apply above threw, this line wouldn't run.
  await prisma.competition.update({
    where: { id: competition.id },
    data: { lastSyncedAt: new Date() },
  });

  return {
    fetched: matches.length,
    createdMatches: applyResult.createdMatches,
    updatedMatches: applyResult.updatedMatches,
    createdMarkets: applyResult.createdMarkets,
    updatedMarkets: applyResult.updatedMarkets,
    settledMarkets: applyResult.settledMarkets,
    totalMatches: applyResult.totalMatches,
    errors: applyResult.errors,
  };
}
