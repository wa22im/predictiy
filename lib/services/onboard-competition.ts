/**
 * Onboard a competition from football-data.org.
 *
 * Companion to `lib/services/ingest-league.ts` (the api-football.com
 * pipeline) but built on the new football-data.org client. Used by
 * the admin "Onboard" button on the Discover page.
 *
 * The bulk of the work (upserting matches + creating the three
 * default markets + auto-settling transitions) lives in
 * `lib/services/apply-football-data-matches.ts`. This module is the
 * thin competition-level shell that:
 *   1. Resolves the display name + season year from the catalogue.
 *   2. Fetches the season's matches.
 *   3. Upserts the Competition row.
 *   4. Calls the shared helper to apply the matches.
 *
 * For each match the helper creates the same three default markets
 * the existing ingest pipeline creates (unconditional, idempotent on
 * (matchId, type, title)):
 *   - EXACT_SCORE      "Predict the final score"
 *   - HALF_SCORING     "Which teams score in which half?"
 *   - IN_GAME_PENALTY  "Which team gets an in-game penalty?"
 *
 * The "correct winner" credit is folded into EXACT_SCORE's scoring —
 * no separate winner market.
 *
 * Idempotency contract:
 *   - The competition row is upserted by name. externalSource,
 *     externalLeagueId (the football-data.org code) and externalSeason
 *     are refreshed on every run.
 *   - Each Match is upserted by `apiMatchId = String(match.id)`. The
 *     provider's id is the lookup key for future sync calls — never
 *     invent a new one.
 *   - Each market is upserted on (matchId, type, title) — running
 *     this twice is a no-op.
 *
 * Penalties: the football-data.org feed exposes `score.penalties`
 * which is the *shootout* result, NOT in-game penalties. The
 * IN_GAME_PENALTY market tracks in-game penalties awarded during
 * regular/extra time, so we leave `homePenalties` / `awayPenalties`
 * NULL on ingest. The admin sets those columns via the match-update
 * API when the settlement hub UI lands.
 *
 * Half-time goals and final scores are taken from the score object.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getCompetition,
  getCompetitionMatches,
  FootballDataError,
} from "@/lib/services/football-data";
import { applyFootballDataMatches } from "@/lib/services/apply-football-data-matches";

export type OnboardInput = {
  /**
   * football-data.org competition code (e.g. "PL", "WC", "BSA").
   * Stored verbatim on Competition.externalLeagueId.
   */
  code: string;
  /**
   * Optional display name. Defaults to the competition's own `name`
   * (e.g. "Premier League 2025/26"). The admin can override the
   * display label without affecting the lookup key.
   */
  displayName?: string;
};

export type OnboardResult = {
  competitionId: string;
  /** Display name actually persisted (after the override). */
  competitionName: string;
  /** Matches the API reported as finished (status = FINISHED) on the
   *  initial fetch — useful for the admin to know what will be
   *  settled on the next sync. */
  finishedAtIngest: number;
  createdMatches: number;
  updatedMatches: number;
  createdMarkets: number;
  updatedMarkets: number;
  totalMatches: number;
  errors: { apiMatchId?: string; message: string }[];
};

export async function onboardCompetition(input: OnboardInput): Promise<OnboardResult> {
  if (!input.code || !input.code.trim()) {
    throw new OnboardError(400, "Competition code is required");
  }
  const code = input.code.trim();

  // 1. Look up the competition's display metadata so we have a
  //    sensible default name and the current season start date.
  const compMeta = await getCompetition(code);
  if (!compMeta) {
    throw new OnboardError(404, `football-data.org returned no competition for code "${code}"`);
  }
  const displayName = input.displayName?.trim() || compMeta.name;
  const season = compMeta.currentSeason
    ? Number(compMeta.currentSeason.startDate.slice(0, 4))
    : new Date().getUTCFullYear();

  // 2. Pull the matches for the current season.
  const matches = await getCompetitionMatches(code, { season });

  // 2.5. Guard against an empty match list. The football-data.org
  //     free tier sometimes returns 0 matches for in-progress or
  //     not-yet-published seasons (e.g. PL 2025 returns 0). Onboarding
  //     a competition with no matches would create an empty roster —
  //     confusing for the admin. Fail loudly so they know the data
  //     isn't available yet.
  if (matches.length === 0) {
    throw new OnboardError(
      422,
      `football-data.org returned 0 matches for code "${code}" in season ${season}. ` +
        `The schedule may not be published yet, or this season is restricted on your ` +
        `subscription tier. Try a different season (the catalogue's currentSeason shows ` +
        `what's available) or a different competition.`
    );
  }

  // 3. Upsert the competition row. externalLeagueId holds the code
  //    (a non-numeric string) so the next sync call can route back
  //    here.
  const competition = await prisma.competition.upsert({
    where: { name: displayName },
    create: {
      name: displayName,
      externalSource: "football-data",
      externalLeagueId: code,
      externalSeason: season,
    },
    update: {
      externalSource: "football-data",
      externalLeagueId: code,
      externalSeason: season,
    },
  });

  // 4. Apply each match + the 3 default markets (and auto-settle
  //    any matches that are reported as FINISHED at ingest time).
  const applyResult = await applyFootballDataMatches(competition.id, matches, {
    autoSettle: true,
  });

  // Onboard surfaces a `finishedAtIngest` count for admin visibility
  // — the helper doesn't track this (it would be redundant work), so
  // we derive it here from the API input.
  const finishedAtIngest = matches.filter((m) => m.status === "FINISHED" || m.status === "AWARDED").length;

  return {
    competitionId: competition.id,
    competitionName: displayName,
    finishedAtIngest,
    createdMatches: applyResult.createdMatches,
    updatedMatches: applyResult.updatedMatches,
    createdMarkets: applyResult.createdMarkets,
    updatedMarkets: applyResult.updatedMarkets,
    totalMatches: applyResult.totalMatches,
    errors: applyResult.errors,
  };
}

export class OnboardError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "OnboardError";
  }
}

/**
 * Re-export the FootballDataError so callers don't need a second
 * import. The API route catches both.
 */
export { FootballDataError };
