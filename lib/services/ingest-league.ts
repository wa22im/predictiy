/**
 * Ingestion service: turns api-football fixtures into our Match + BetMarket
 * rows. Idempotent — re-running with the same data is a no-op.
 *
 * Two entry points:
 *   - ingestLeague()      first-time onboard: competition, all fixtures
 *   - syncCompetition()   incremental: pick up status / score updates
 *
 * Maps our stage from the API's `league.round`:
 *   "Regular Season - 1"  →  "REGULAR_SEASON"
 *   "Group A - 1"         →  "GROUP_STAGE"
 *   "Quarter-Finals"      →  "KNOCKOUT"
 *   "Semi-Finals"         →  "KNOCKOUT"
 *   "Final"               →  "KNOCKOUT"
 *
 * Only the round label is captured; the API doesn't separate knockout
 * stages in a way we care about. We use "OUTRIGHT" for non-fixture
 * markets (e.g., tournament winner) which are not created by this
 * service — those are still managed via the JSON-paste hydration
 * terminal.
 *
 * For each match, three default markets are created (unconditional,
 * idempotent via (matchId, type, title)):
 *   - EXACT_SCORE      "Predict the final score"
 *   - HALF_SCORING     "Which teams score in which half?"
 *   - IN_GAME_PENALTY  "Which team gets an in-game penalty?"
 *
 * The "correct winner" credit is folded into EXACT_SCORE's scoring — the
 * winner is derived from the predicted vs. final score, so a separate
 * winner market is not needed.
 *
 * Auto-settle (on FT detection with both goals present):
 *   - EXACT_SCORE   ← "X-Y" from final score
 *   - HALF_SCORING  ← derived from HT + final scores (when HT data exists)
 *   - IN_GAME_PENALTY  ← manual settlement only (API doesn't expose data)
 */

import { prisma } from "@/lib/prisma";
import {
  type Fixture,
  getLeagueFixtures,
  getLeagueById,
  ApiFootballError,
} from "@/lib/services/api-football";
import { settleMarket, SettleError } from "@/lib/services/settle-market";

export type IngestLeagueInput = {
  /** Display name for the competition. e.g., "Premier League 2024-25" */
  name: string;
  externalLeagueId: number;
  externalSeason: number;
};

export type IngestLeagueResult = {
  competitionId: string;
  created: { competition: boolean; matches: number; markets: number };
  updated: { matches: number; markets: number };
  /** Total fixtures returned by the API (even if all errors). */
  fetched: number;
  /** Set when fetched === 0 — the league/season exists but the API
   *  has no fixtures yet (common for upcoming tournaments). */
  warning: string | null;
  errors: { apiMatchId?: string; message: string }[];
};

export type SyncResult = {
  competitionId: string;
  fetched: number;
  updated: { matches: number; markets: number; settledMarkets: number };
  errors: { apiMatchId?: string; message: string }[];
};

// ---- Public entry points --------------------------------------------------

export async function ingestLeague(
  input: IngestLeagueInput,
): Promise<IngestLeagueResult> {
  // Policy guard: only ingest the CURRENT season per league. The
  // searchLeagues response includes `current: boolean` on each
  // season — we re-check it server-side because the UI could lie.
  // Cost: 1 API call. Cheaper than ingesting a wrong season by
  // mistake (which can be hundreds of fixtures).
  const leagueInfo = await getLeagueById(input.externalLeagueId);
  const season = leagueInfo?.seasons.find((s) => s.year === input.externalSeason);
  if (!season) {
    throw new ApiFootballError(
      `Season ${input.externalSeason} not found for league ${input.externalLeagueId}.`,
      404,
    );
  }
  if (!season.current) {
    throw new ApiFootballError(
      `Season ${input.externalSeason} is not the current season for this league. predicty only ingests current/upcoming seasons to avoid wasting API budget on historical data.`,
      400,
    );
  }
  // Belt-and-suspenders: even if api-football's `current` flag is
  // wrong, refuse any season more than 1 year in the past.
  const currentYear = new Date().getUTCFullYear();
  if (input.externalSeason < currentYear - 1) {
    throw new ApiFootballError(
      `Season ${input.externalSeason} is too old (more than 1 year before ${currentYear}). predicty only ingests current/upcoming seasons.`,
      400,
    );
  }

  // Upsert the competition row first so we have a stable id to attach
  // matches to, even if the fixture fetch partially fails.
  const existing = await prisma.competition.findUnique({
    where: { name: input.name },
    select: { id: true },
  });
  const competition = await prisma.competition.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      externalSource: "api-football",
      externalLeagueId: String(input.externalLeagueId),
      externalSeason: input.externalSeason,
    },
    update: {
      externalSource: "api-football",
      externalLeagueId: String(input.externalLeagueId),
      externalSeason: input.externalSeason,
    },
  });

  const fixtures = await getLeagueFixtures(input.externalLeagueId, input.externalSeason);
  const result = await applyFixtures(competition.id, fixtures);

  return {
    competitionId: competition.id,
    created: {
      competition: !existing,
      matches: result.createdMatches,
      markets: result.createdMarkets,
    },
    updated: {
      matches: result.updatedMatches,
      markets: result.updatedMarkets,
    },
    fetched: fixtures.length,
    warning:
      fixtures.length === 0
        ? "API returned 0 fixtures. The league/season exists but the schedule hasn't been published yet. Try again later, or pick a different season."
        : null,
    errors: result.errors,
  };
}

export async function syncCompetition(competitionId: string): Promise<SyncResult> {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
  });
  if (!competition) {
    throw new ApiFootballError(`Competition ${competitionId} not found`, 404);
  }
  if (!competition.externalSource || !competition.externalLeagueId || !competition.externalSeason) {
    throw new ApiFootballError(
      `Competition ${competition.name} is not linked to an external provider. Use the JSON hydration terminal instead.`,
      400,
    );
  }

  const fixtures = await getLeagueFixtures(
    Number(competition.externalLeagueId),
    competition.externalSeason,
  );
  const result = await applyFixtures(competitionId, fixtures);

  // Update the lastSyncedAt stamp regardless of partial failures —
  // we only want to skip the next tick if a sync actually ran.
  await prisma.competition.update({
    where: { id: competitionId },
    data: { lastSyncedAt: new Date() },
  });

  return {
    competitionId,
    fetched: fixtures.length,
    updated: {
      matches: result.updatedMatches,
      markets: result.updatedMarkets,
      settledMarkets: result.settledMarkets,
    },
    errors: result.errors,
  };
}

/** Sync every onboarded competition. Used by the cron. */
export async function syncAllCompetitions(): Promise<SyncResult[]> {
  const onboarded = await prisma.competition.findMany({
    where: {
      externalSource: { not: null },
      externalLeagueId: { not: null },
      externalSeason: { not: null },
    },
    select: { id: true },
  });
  const results: SyncResult[] = [];
  for (const { id } of onboarded) {
    try {
      results.push(await syncCompetition(id));
    } catch (e) {
      results.push({
        competitionId: id,
        fetched: 0,
        updated: { matches: 0, markets: 0, settledMarkets: 0 },
        errors: [{ message: (e as Error).message }],
      });
    }
  }
  return results;
}

// ---- Core: apply a list of fixtures --------------------------------------

type ApplyResult = {
  createdMatches: number;
  updatedMatches: number;
  createdMarkets: number;
  updatedMarkets: number;
  settledMarkets: number;
  errors: { apiMatchId?: string; message: string }[];
};

async function applyFixtures(
  competitionId: string,
  fixtures: Fixture[],
): Promise<ApplyResult> {
  const result: ApplyResult = {
    createdMatches: 0,
    updatedMatches: 0,
    createdMarkets: 0,
    updatedMarkets: 0,
    settledMarkets: 0,
    errors: [],
  };

  for (const f of fixtures) {
    try {
      const apiMatchId = String(f.fixture.id);
      const stage = mapStage(f.league.round);
      const status = mapStatus(f.fixture.status.short);

      const match = await prisma.match.upsert({
        where: { apiMatchId },
        update: {
          homeTeam: f.teams.home.name,
          awayTeam: f.teams.away.name,
          kickoffTime: new Date(f.fixture.date),
          stage,
          status,
          homeScore: f.goals.home,
          awayScore: f.goals.away,
          homeHtGoals: f.score.halftime.home,
          awayHtGoals: f.score.halftime.away,
          homePenalties: f.score.penalty.home,
          awayPenalties: f.score.penalty.away,
          externalStatus: f.fixture.status.short,
          competitionId,
        },
        create: {
          apiMatchId,
          homeTeam: f.teams.home.name,
          awayTeam: f.teams.away.name,
          kickoffTime: new Date(f.fixture.date),
          stage,
          status,
          homeScore: f.goals.home,
          awayScore: f.goals.away,
          homeHtGoals: f.score.halftime.home,
          awayHtGoals: f.score.halftime.away,
          homePenalties: f.score.penalty.home,
          awayPenalties: f.score.penalty.away,
          externalStatus: f.fixture.status.short,
          competitionId,
        },
      });

      // Track whether the match just transitioned to FINISHED so we
      // can auto-settle the default market below.
      const justFinished =
        f.fixture.status.short === "FT" && f.goals.home !== null && f.goals.away !== null;

      // Default markets per match:
      //   1. EXACT_SCORE       "Predict the final score"
      //   2. HALF_SCORING      "Which teams score in which half?"
      //   3. IN_GAME_PENALTY   "Which team gets an in-game penalty?"
      //
      // Each is idempotent via (matchId, type, title).
      await prisma.betMarket.upsert({
        where: {
          matchId_type_title: {
            matchId: match.id,
            type: "EXACT_SCORE",
            title: "Predict the final score",
          },
        },
        update: {},
        create: {
          matchId: match.id,
          type: "EXACT_SCORE",
          title: "Predict the final score",
        },
      });

      await prisma.betMarket.upsert({
        where: {
          matchId_type_title: {
            matchId: match.id,
            type: "HALF_SCORING",
            title: "Which teams score in which half?",
          },
        },
        update: {},
        create: {
          matchId: match.id,
          type: "HALF_SCORING",
          title: "Which teams score in which half?",
          options: HALF_SCORING_OPTIONS,
        },
      });

      await prisma.betMarket.upsert({
        where: {
          matchId_type_title: {
            matchId: match.id,
            type: "IN_GAME_PENALTY",
            title: "Which team gets an in-game penalty?",
          },
        },
        update: {},
        create: {
          matchId: match.id,
          type: "IN_GAME_PENALTY",
          title: "Which team gets an in-game penalty?",
          options: IN_GAME_PENALTY_OPTIONS,
        },
      });

      // Auto-settle each market if the fixture is FT and we have the data.
      if (justFinished) {
        // 1. EXACT_SCORE
        await tryAutoSettle(match.id, "EXACT_SCORE", "Predict the final score",
          `${f.goals.home}-${f.goals.away}`,
          apiMatchId, result);

        // 2. HALF_SCORING — only if we have HT data. Derived from the
        //    score object: which (team, half) pairs actually scored.
        if (f.score.halftime.home !== null && f.score.halftime.away !== null) {
          const homeHt = f.score.halftime.home;
          const awayHt = f.score.halftime.away;
          const homeSecond = (f.goals.home ?? 0) - homeHt;
          const awaySecond = (f.goals.away ?? 0) - awayHt;
          const codes: string[] = [];
          if (homeHt > 0) codes.push("A_1H");
          if (homeSecond > 0) codes.push("A_2H");
          if (awayHt > 0) codes.push("B_1H");
          if (awaySecond > 0) codes.push("B_2H");
          await tryAutoSettle(
            match.id,
            "HALF_SCORING",
            "Which teams score in which half?",
            codes.join(","),
            apiMatchId,
            result,
          );
        }

        // 3. IN_GAME_PENALTY — no auto-settle. The API only surfaces
        //    shootout penalties, not in-game penalties during regular/
        //    extra time. Admin settles these manually via the Settlement
        //    Hub.
      }
    } catch (e) {
      result.errors.push({
        apiMatchId: String(f.fixture.id),
        message: (e as Error).message,
      });
    }
  }

  return result;
}

// ---- Mappers --------------------------------------------------------------

function mapStage(round: string | null): string {
  if (!round) return "UNKNOWN";
  const r = round.toLowerCase();
  if (r.includes("group")) return "GROUP_STAGE";
  if (r.includes("regular season") || r.includes("matchday") || r.includes("week"))
    return "REGULAR_SEASON";
  if (
    r.includes("quarter") ||
    r.includes("semi") ||
    r.includes("final") ||
    r.includes("round of") ||
    r.includes("knockout") ||
    r.includes("play-off") ||
    r.includes("playoff")
  ) {
    return "KNOCKOUT";
  }
  return "UNKNOWN";
}

function mapStatus(short: string): "SCHEDULED" | "FINISHED" {
  switch (short) {
    case "FT":
    case "AET":
    case "PEN":
    case "AWD":
    case "WO":
      return "FINISHED";
    default:
      return "SCHEDULED";
  }
}

// ---- Market option presets -----------------------------------------------

/**
 * Half-scoring option set. Codes are "<team>_<half>": A = home, B = away,
 * 1H = first half, 2H = second half. Auto-settle derives the correct
 * answer from the score object (see the HALF_SCORING auto-settle branch
 * above).
 */
const HALF_SCORING_OPTIONS = ["A_1H", "A_2H", "B_1H", "B_2H"];

/**
 * In-game penalty options. Refers to a penalty awarded during
 * regular/extra time, NOT the post-match shootout. The API doesn't
 * surface this data, so the market is created but never auto-settled —
 * admin settles manually via the Settlement Hub.
 */
const IN_GAME_PENALTY_OPTIONS = ["HOME", "AWAY", "NONE"];

// ---- Auto-settle helper -------------------------------------------------

async function tryAutoSettle(
  matchId: string,
  marketType: string,
  marketTitle: string,
  correctAnswer: string,
  apiMatchId: string,
  result: ApplyResult,
): Promise<void> {
  try {
    const market = await prisma.betMarket.findUnique({
      where: {
        matchId_type_title: {
          matchId,
          type: marketType,
          title: marketTitle,
        },
      },
      select: { id: true, isSettled: true },
    });
    if (!market || market.isSettled) return;
    await settleMarket({
      marketId: market.id,
      correctAnswer,
    });
    result.settledMarkets += 1;
  } catch (e) {
    if (e instanceof SettleError) {
      if (e.message !== "ALREADY_SETTLED") {
        result.errors.push({ apiMatchId, message: `settle ${marketType}: ${e.message}` });
      }
    } else {
      result.errors.push({
        apiMatchId,
        message: `settle ${marketType}: ${(e as Error).message}`,
      });
    }
  }
}
