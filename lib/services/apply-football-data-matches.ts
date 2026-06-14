/**
 * Shared helper: apply a list of football-data.org matches to a
 * competition. Used by both:
 *   - `lib/services/onboard-competition.ts` (first-time ingest)
 *   - `lib/services/sync-football-data-competition.ts` (incremental sync)
 *
 * Behaviour per match:
 *   1. Upsert the Match row by `apiMatchId = String(match.id)`. The
 *      provider's id is preserved verbatim so future sync calls can
 *      look the row up.
 *   2. Upsert a `CompetitionMatch` row linking the match to this
 *      competition. The match's primary vendor parent is still
 *      `Match.competitionId` (typed FK, one-to-many) — the
 *      `CompetitionMatch` join row is what enables the future
 *      mixed-tournament feature (a single match can appear in more
 *      than one custom competition). See `prisma/schema.prisma` for
 *      the model definition.
 *   3. Create the three default markets idempotently on
 *      (matchId, type, title):
 *        - EXACT_SCORE       "Predict the final score"
 *        - HALF_SCORING      "Which teams score in which half?"
 *        - IN_GAME_PENALTY   "Which team gets an in-game penalty?"
 *   4. If the upsert *transitioned* the match into FINISHED (previous
 *      status was not FINISHED, new status is FINISHED) and the caller
 *      did not disable auto-settle, run `autoSettleMatch` to settle
 *      the three default markets with the freshly-applied data.
 *
 * Idempotency:
 *   - Matches are upserted by `apiMatchId`. Re-running with no new
 *     data is a no-op (every row is "updated" with the same values).
 *   - `CompetitionMatch` is upserted on the `(matchId, competitionId)`
 *     compound key. Re-running is a no-op (the row already exists).
 *   - Markets are upserted on (matchId, type, title). Re-running does
 *     not create duplicates.
 *   - Auto-settle only fires on the *transition*. Re-syncing an
 *     already-FINISHED match does NOT re-settle; the markets stay
 *     settled with their previous correctAnswer.
 *
 * Error handling:
 *   - The function never throws. A per-match failure is recorded in
 *     `result.errors` and the loop continues. The sync caller (and
 *     the onboard caller) get a partial result they can surface.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import {
  type Match as FootballDataMatch,
} from "@/lib/services/football-data";
import { mapStage } from "@/lib/services/stage-mapper";
import { autoSettleMatch } from "@/lib/services/auto-settle";

export type ApplyFootballDataMatchesOptions = {
  /**
   * Whether to auto-settle the three default markets when a match
   * transitions to FINISHED during this run. Defaults to `true` — the
   * sync path wants this behaviour so newly-finished matches settle
   * without admin intervention. Set to `false` for callers that want
   * to control settlement manually.
   */
  autoSettle?: boolean;
};

export type ApplyFootballDataMatchesResult = {
  createdMatches: number;
  updatedMatches: number;
  createdMarkets: number;
  updatedMarkets: number;
  settledMarkets: number;
  totalMatches: number;
  errors: { apiMatchId?: string; message: string }[];
};

const HALF_SCORING_OPTIONS = ["A_1H", "A_2H", "B_1H", "B_2H"];
const IN_GAME_PENALTY_OPTIONS = ["HOME", "AWAY"];

/**
 * Map football-data.org's status string to our 3-value enum:
 *   FINISHED  → FINISHED
 *   IN_PLAY | PAUSED  → GOING  (in progress)
 *   everything else (TIMED, SCHEDULED, AWARDED, CANCELLED, POSTPONED)
 *                     → SCHEDULED
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
 * Apply a batch of football-data.org matches to a competition.
 *
 * @param competitionId The Competition row to attach the matches to.
 * @param matches       The matches from the football-data.org v4 API.
 * @param options       `{ autoSettle?: boolean }` (default `true`).
 *
 * @returns Counts of created/updated/settled rows + any per-match
 *          errors. Does not throw.
 */
export async function applyFootballDataMatches(
  competitionId: string,
  matches: FootballDataMatch[],
  options: ApplyFootballDataMatchesOptions = {},
): Promise<ApplyFootballDataMatchesResult> {
  const { autoSettle = true } = options;

  const result: ApplyFootballDataMatchesResult = {
    createdMatches: 0,
    updatedMatches: 0,
    createdMarkets: 0,
    updatedMarkets: 0,
    settledMarkets: 0,
    totalMatches: matches.length,
    errors: [],
  };

  for (const m of matches) {
    try {
      const apiMatchId = String(m.id);
      const stage = mapStage(m.stage);
      const status = mapStatus(m.status);

      // Per-match metadata stored in `Match.details`. All fields are
      // small + fully derived from the API; no user-set fields to
      // preserve, so a plain overwrite is correct.
      const matchDetails = {
        matchday: m.matchday ?? null,
        group: m.group ?? null,
        scoreWinner: m.score.winner ?? null,
        scoreDuration: m.score.duration ?? null,
        lastUpdated: m.lastUpdated ?? null,
      };

      // Look up the existing match row's status BEFORE the upsert so
      // we can detect a *transition* into FINISHED (which is the
      // trigger for auto-settle). Doing this in the same call as the
      // upsert isn't possible — Prisma's upsert doesn't return the
      // previous state — so we pay for one extra read per match.
      const prev = await prisma.match.findUnique({
        where: { apiMatchId },
        select: { id: true, status: true },
      });
      const prevStatus = prev?.status ?? null;

      const match = await prisma.match.upsert({
        where: { apiMatchId },
        create: {
          apiMatchId,
          homeTeam: m.homeTeam.name,
          awayTeam: m.awayTeam.name,
          kickoffTime: new Date(m.utcDate),
          stage,
          status,
          homeScore: m.score.fullTime.home,
          awayScore: m.score.fullTime.away,
          homeHtGoals: m.score.halfTime.home,
          awayHtGoals: m.score.halfTime.away,
          // homePenalties / awayPenalties: intentionally null on
          // ingest — see file header. The settlement hub sets these.
          externalStatus: m.status,
          homeCrest: m.homeTeam.crest,
          awayCrest: m.awayTeam.crest,
          competitionId,
          details: matchDetails,
        },
        update: {
          homeTeam: m.homeTeam.name,
          awayTeam: m.awayTeam.name,
          kickoffTime: new Date(m.utcDate),
          stage,
          status,
          homeScore: m.score.fullTime.home,
          awayScore: m.score.fullTime.away,
          homeHtGoals: m.score.halfTime.home,
          awayHtGoals: m.score.halfTime.away,
          externalStatus: m.status,
          homeCrest: m.homeTeam.crest,
          awayCrest: m.awayTeam.crest,
          competitionId,
          details: matchDetails,
        },
      });

      // Link this match to its parent competition via the
      // CompetitionMatch join table. The match's primary vendor
      // parent is still `Match.competitionId` (typed FK, used for
      // the cron's read paths); the join row is what powers the
      // cross-tournament / mixed-tournament queries (e.g. "show
      // me every competition a match is referenced by"). We use
      // upsert with an empty `update` block so re-running this
      // function is a no-op for the join table.
      await prisma.competitionMatch.upsert({
        where: {
          matchId_competitionId: {
            matchId: match.id,
            competitionId,
          },
        },
        create: { matchId: match.id, competitionId },
        update: {},
      });

      if (prev) result.updatedMatches += 1;
      else result.createdMatches += 1;

      // Three default markets per match, idempotent on
      // (matchId, type, title). Same titles as the api-football
      // pipeline so the Settlement Hub renders them consistently.
      for (const mk of [
        { type: "EXACT_SCORE", title: "Predict the final score", options: null as string[] | null },
        { type: "HALF_SCORING", title: "Which teams score in which half?", options: HALF_SCORING_OPTIONS },
        { type: "IN_GAME_PENALTY", title: "Which team gets an in-game penalty?", options: IN_GAME_PENALTY_OPTIONS },
      ]) {
        const marketExisted = await prisma.betMarket.findUnique({
          where: {
            matchId_type_title: {
              matchId: match.id,
              type: mk.type,
              title: mk.title,
            },
          },
          select: { id: true },
        });
        await prisma.betMarket.upsert({
          where: {
            matchId_type_title: {
              matchId: match.id,
              type: mk.type,
              title: mk.title,
            },
          },
          update: mk.options ? { options: mk.options } : {},
          create: {
            matchId: match.id,
            type: mk.type,
            title: mk.title,
            options: mk.options ?? undefined,
          },
        });
        if (marketExisted) result.updatedMarkets += 1;
        else result.createdMarkets += 1;
      }

      // Auto-settle on transition into FINISHED. Re-syncing an
      // already-FINISHED match is a no-op for the markets (their
      // correctAnswer is preserved; the auto-settler logs a warning
      // for any market that was already settled).
      if (autoSettle && prevStatus !== "FINISHED" && status === "FINISHED") {
        const outcome = await autoSettleMatch({
          id: match.id,
          homeScore: m.score.fullTime.home,
          awayScore: m.score.fullTime.away,
          homeHtGoals: m.score.halfTime.home,
          awayHtGoals: m.score.halfTime.away,
          // football-data.org's `score.penalties` is the shootout
          // result, not in-game penalties — we never read it. The
          // admin can set these columns via the match-update API if
          // they want to auto-settle IN_GAME_PENALTY later.
          homePenalties: null,
          awayPenalties: null,
        });
        result.settledMarkets += outcome.settlements.length;
        for (const w of outcome.warnings) {
          result.errors.push({ apiMatchId, message: w });
        }
      }
    } catch (e) {
      result.errors.push({
        apiMatchId: String(m.id),
        message: (e as Error).message,
      });
    }
  }

  return result;
}
