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
import { Prisma } from "@/lib/generated/prisma/client";
import { getCompetition, getCompetitionMatches } from "@/lib/services/football-data";
import { applyFootballDataMatches } from "@/lib/services/apply-football-data-matches";
import { parseCompetitionEndDate } from "@/lib/services/competition-end-date";

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

  // 5.5. Refresh competition metadata from the provider. The matches
  //      endpoint doesn't carry season/area/emblem data, so we have to
  //      hit the single-competition endpoint too. A failure here is
  //      non-fatal — the matches are the primary payload, and we'd
  //      rather stamp lastSyncedAt (so the admin sees the sync ran)
  //      than abort over a metadata refresh.
  //
  //      We capture rich metadata into Competition.details (area,
  //      code, type, emblem, plan, currentSeason, availableSeasons,
  //      lastUpdated) and compute isActive from currentSeason.winner.
  //
  //      CRITICAL: when merging with existing details, we must
  //      preserve user-set fields like scoringOverridesByStage. The
  //      pattern is:
  //        { ...apiFetchedFields, ...userSetFields }
  //      so that the user's overrides win for keys that the API
  //      doesn't provide.
  let endDate: Date | undefined;
  let richDetails: Record<string, unknown> | null = null;
  try {
    const compMeta = await getCompetition(code);
    endDate = parseCompetitionEndDate(compMeta?.currentSeason?.endDate);

    if (compMeta) {
      const currentSeasonWinner = compMeta.currentSeason?.winner;
      richDetails = {
        area: compMeta.area ?? null,
        code: compMeta.code ?? null,
        type: compMeta.type ?? null,
        emblem: compMeta.emblem ?? null,
        plan: compMeta.plan ?? null,
        currentSeason: {
          id: compMeta.currentSeason?.id ?? null,
          startDate: compMeta.currentSeason?.startDate ?? null,
          endDate: compMeta.currentSeason?.endDate ?? null,
          currentMatchday: compMeta.currentSeason?.currentMatchday ?? null,
          winner: currentSeasonWinner ?? null,
        },
        availableSeasons: compMeta.numberOfAvailableSeasons ?? null,
        lastUpdated: compMeta.lastUpdated ?? null,
        // isActive: true if the current season is still in progress
        // (no winner declared). The principal uses this flag to
        // know whether to expect new matches from a sync.
        isActive: currentSeasonWinner === null,
      };
    }
  } catch (e) {
    console.warn(
      `[syncFootballDataCompetition] competition metadata refresh failed for ${competition.name} (${competition.id}): ${(e as Error).message}. Matches were applied; competition metadata left unchanged.`,
    );
  }

  // 6. Stamp lastSyncedAt. We only update it on success — if the
  //    apply above threw, this line wouldn't run.
  const updateData: {
    lastSyncedAt: Date;
    endDate?: Date;
    details?: Prisma.InputJsonValue;
  } = {
    lastSyncedAt: new Date(),
  };
  if (endDate) updateData.endDate = endDate;
  if (richDetails) {
    // Load existing details to preserve user-set fields.
    // (One extra round-trip, but only on the metadata refresh path
    // which already does a separate `getCompetition` call.)
    const existing = await prisma.competition.findUnique({
      where: { id: competition.id },
      select: { details: true },
    });
    const existingDetails =
      (existing?.details as Record<string, unknown> | null) ?? {};

    // The user-set fields we want to preserve. Add more here as the
    // schema grows.
    const userSetFields = {
      scoringOverridesByStage: existingDetails.scoringOverridesByStage,
    };

    // Remove undefined values to keep the JSONB clean.
    const cleanUserFields = Object.fromEntries(
      Object.entries(userSetFields).filter(([, v]) => v !== undefined),
    );

    // Merge: API fields first, user-set fields win for keys that
    // both define. The cast through `unknown` is required because
    // the spread result is `{ [k: string]: unknown }` (the `unknown`
    // type leaks from our `richDetails: Record<string, unknown>`
    // declaration), but every concrete value here is JSON-serializable
    // — strings, numbers, booleans, null, and nested plain objects.
    updateData.details = {
      ...richDetails,
      ...cleanUserFields,
    } as Prisma.InputJsonValue;
  }

  await prisma.competition.update({
    where: { id: competition.id },
    data: updateData,
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
