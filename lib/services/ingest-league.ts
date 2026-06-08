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
 */

import { prisma } from "@/lib/prisma";
import {
  type Fixture,
  getLeagueFixtures,
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

      const hadPenaltyShootout =
        f.score.penalty.home !== null && f.score.penalty.away !== null;

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
      //   2. HT_FT             "Half-time / Full-time"  (always)
      //   3. PENALTY_SHOOTOUT  "Penalty shootout winner" (knockout only)
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
            type: "HT_FT",
            title: "Half-time / Full-time",
          },
        },
        update: {},
        create: {
          matchId: match.id,
          type: "HT_FT",
          title: "Half-time / Full-time",
          options: HT_FT_OPTIONS,
        },
      });

      if (stage === "KNOCKOUT") {
        await prisma.betMarket.upsert({
          where: {
            matchId_type_title: {
              matchId: match.id,
              type: "PENALTY_SHOOTOUT",
              title: "Penalty shootout winner",
            },
          },
          update: {},
          create: {
            matchId: match.id,
            type: "PENALTY_SHOOTOUT",
            title: "Penalty shootout winner",
            options: PENALTY_OPTIONS,
          },
        });
      }

      // Auto-settle each market if the fixture is FT and we have the data.
      if (justFinished) {
        // 1. EXACT_SCORE
        await tryAutoSettle(match.id, "EXACT_SCORE", "Predict the final score",
          `${f.goals.home}-${f.goals.away}`,
          apiMatchId, result);

        // 2. HT_FT — only if we have HT data
        if (f.score.halftime.home !== null && f.score.halftime.away !== null) {
          const ftOutcome = outcome(f.goals.home, f.goals.away);
          const htOutcome = outcome(f.score.halftime.home, f.score.halftime.away);
          await tryAutoSettle(match.id, "HT_FT", "Half-time / Full-time",
            `${htOutcome}/${ftOutcome}`,
            apiMatchId, result);
        }

        // 3. PENALTY_SHOOTOUT — only for knockout with shootout data
        if (stage === "KNOCKOUT" && hadPenaltyShootout) {
          const winner =
            f.score.penalty.home! > f.score.penalty.away! ? "HOME" : "AWAY";
          await tryAutoSettle(match.id, "PENALTY_SHOOTOUT", "Penalty shootout winner",
            winner, apiMatchId, result);
        }
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
 * All 9 Half-time / Full-time combinations.
 * Format: "<HT outcome>/<FT outcome>" where outcome is H (home win),
 * D (draw), A (away win). E.g. "H/H" = home led at HT and won FT.
 */
const HT_FT_OPTIONS = [
  "H/H", "H/D", "H/A",
  "D/H", "D/D", "D/A",
  "A/H", "A/D", "A/A",
];

/** Penalty shootout winner options (only relevant for knockout matches). */
const PENALTY_OPTIONS = ["HOME", "AWAY", "NO_SHOOTOUT"];

// ---- Outcome helper + auto-settle helper --------------------------------

/** "H" if home score > away, "D" if equal, "A" if away score > home. */
function outcome(home: number | null, away: number | null): "H" | "D" | "A" {
  if (home === null || away === null) return "D";
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

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
