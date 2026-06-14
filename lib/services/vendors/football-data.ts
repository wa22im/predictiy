/**
 * football-data.org vendor adapter.
 *
 * The first concrete implementation of the `VendorAdapter` contract.
 * Delegates to the existing football-data v4 client
 * (`lib/services/football-data.ts`) and to the per-stage / per-status
 * mappers in `lib/services/stage-mapper.ts` and the inline
 * `mapStatus` helper (which is also re-declared in
 * `lib/services/apply-football-data-matches.ts` — see the comment
 * there for the canonical definition).
 *
 * This adapter is a thin mapping layer. It does NOT touch the
 * database. The actual writes (Competition upsert, Match upsert,
 * default market creation, auto-settle on transitions) happen in
 * `lib/services/sync-football-data-competition.ts` and
 * `lib/services/apply-football-data-matches.ts`, which call this
 * adapter's `fetchCompetition` / `fetchMatches` / `fetchMatch`.
 *
 * Why the per-status mapping lives here too:
 *   The same `mapStatus` function exists in
 *   `apply-football-data-matches.ts` (where it's used as part of the
 *   upsert path) and here (where it's used to translate the API
 *   response into `MatchInput`). We keep them in sync via a comment
 *   in each file. A future refactor could extract both into
 *   `lib/services/vendors/status-mapper.ts`.
 */

import {
  getCompetition,
  getCompetitionMatches,
  getMatchById,
  type Match as FootballDataMatch,
} from "@/lib/services/football-data";
import { mapStage } from "@/lib/services/stage-mapper";
import type {
  CompetitionInput,
  MatchInput,
  Vendor,
  VendorAdapter,
} from "./adapter";

const VENDOR_NAME: Vendor = "football-data";

/**
 * Map football-data.org's status string to our 3-value enum:
 *   FINISHED | AWARDED           → FINISHED
 *   IN_PLAY | PAUSED             → GOING  (in progress)
 *   everything else (TIMED, SCHEDULED, CANCELLED, POSTPONED) → SCHEDULED
 *
 * Mirrors the inline `mapStatus` in
 * `lib/services/apply-football-data-matches.ts` — both must agree.
 */
function mapStatus(
  status: FootballDataMatch["status"],
): "SCHEDULED" | "GOING" | "FINISHED" {
  switch (status) {
    case "FINISHED":
    case "AWARDED":
      return "FINISHED";
    case "IN_PLAY":
    case "PAUSED":
      return "GOING";
    case "SCHEDULED":
    case "TIMED":
    case "CANCELLED":
    case "POSTPONED":
    default:
      return "SCHEDULED";
  }
}

/**
 * Translate a football-data match into the vendor-agnostic
 * `MatchInput` shape consumed by the apply / sync services.
 */
function mapFootballDataMatch(m: FootballDataMatch): MatchInput {
  return {
    // String form — even when the API uses numeric ids, we store
    // the string form for cross-vendor consistency and to keep
    // `Match.apiMatchId` as a uniform String column.
    externalId: String(m.id),
    homeTeam: m.homeTeam.name,
    awayTeam: m.awayTeam.name,
    kickoffTime: new Date(m.utcDate),
    stage: mapStage(m.stage),
    status: mapStatus(m.status),
    homeScore: m.score.fullTime.home,
    awayScore: m.score.fullTime.away,
    // Vendor-specific fields — the rest of the app doesn't read
    // these directly. The UI pulls `homeCrest` / `awayCrest` from
    // the typed `Match.homeCrest` / `Match.awayCrest` columns, which
    // are populated by the apply step from this same `details`
    // object (so we keep the crests in `details` for completeness).
    details: {
      matchday: m.matchday ?? null,
      group: m.group ?? null,
      scoreWinner: m.score.winner ?? null,
      scoreDuration: m.score.duration ?? null,
      lastUpdated: m.lastUpdated ?? null,
      homeCrest: m.homeTeam.crest,
      awayCrest: m.awayTeam.crest,
      // The raw status string from the API is preserved for
      // debugging and for not-yet-implemented live states
      // (e.g. "AET", "PEN" — the "extra time" and "penalty
      // shootout" markers that we don't yet expose as separate
      // match states).
      externalStatus: m.status,
    },
  };
}

/**
 * Compute the 7-day grace date for a football-data season. The UI
 * keeps a recently-ended tournament visible on the dashboard for
 * 7 more days after the API's official end date — see
 * `Competition.details.endDateWithGrace` in
 * `lib/services/sync-football-data-competition.ts` for the consumer.
 */
function computeEndDateWithGrace(endDate: string | null | undefined): string | null {
  if (!endDate) return null;
  const d = new Date(endDate);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export const footballDataAdapter: VendorAdapter = {
  name: VENDOR_NAME,

  async fetchCompetition(externalLeagueId: string): Promise<CompetitionInput> {
    const comp = await getCompetition(externalLeagueId);

    // Defensive: the football-data v4 client returns null for
    // 404 (no competition matches the code). The callers expect
    // a non-null Competition; we throw to make the failure
    // explicit at the adapter boundary.
    if (!comp) {
      throw new Error(
        `[footballDataAdapter] competition not found for code ${externalLeagueId}`,
      );
    }

    const currentSeason = comp.currentSeason ?? null;
    const endDate = currentSeason?.endDate ?? null;
    const endDateWithGrace = computeEndDateWithGrace(endDate);

    // Season year: prefer the startDate of the current season;
    // fall back to the current calendar year when the API
    // doesn't provide a season (e.g. an out-of-season cup).
    const externalSeason = currentSeason?.startDate
      ? new Date(currentSeason.startDate).getFullYear()
      : new Date().getFullYear();

    return {
      externalId: comp.code ?? externalLeagueId,
      name: comp.name,
      externalSeason,
      details: {
        area: comp.area ?? null,
        code: comp.code ?? null,
        type: comp.type ?? null,
        emblem: comp.emblem ?? null,
        plan: comp.plan ?? null,
        currentSeason: currentSeason
          ? {
              id: currentSeason.id ?? null,
              startDate: currentSeason.startDate ?? null,
              endDate: currentSeason.endDate ?? null,
              currentMatchday: currentSeason.currentMatchday ?? null,
              winner: currentSeason.winner ?? null,
            }
          : null,
        availableSeasons: comp.numberOfAvailableSeasons ?? null,
        lastUpdated: comp.lastUpdated ?? null,
        // isActive: true while the season is still in progress
        // (no winner declared). The principal uses this flag to
        // know whether to expect new matches from a sync.
        isActive: currentSeason?.winner === null || currentSeason?.winner === undefined,
        endDateWithGrace,
      } satisfies Record<string, unknown>,
    };
  },

  async fetchMatches(
    externalLeagueId: string,
    _season: number,
  ): Promise<MatchInput[]> {
    // The football-data v4 client accepts a season query
    // parameter, but the apply path is happy to receive every
    // match in the current season by default (the API's default
    // is "current season"). The season is a no-op here so the
    // adapter's signature matches the contract; the
    // `getCompetitionMatches` call below uses its own default.
    // Callers that need a specific season (the sync service) pass
    // it through `getCompetitionMatches` directly, not through
    // this adapter method.
    const matches = await getCompetitionMatches(externalLeagueId);
    return matches.map(mapFootballDataMatch);
  },

  async fetchMatch(externalMatchId: string): Promise<MatchInput> {
    const match = await getMatchById(externalMatchId);
    return mapFootballDataMatch(match);
  },
};
