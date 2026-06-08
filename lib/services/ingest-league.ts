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
          externalStatus: f.fixture.status.short,
          competitionId,
        },
      });

      // Track whether the match just transitioned to FINISHED so we
      // can auto-settle the default market below.
      const justFinished =
        f.fixture.status.short === "FT" && f.goals.home !== null && f.goals.away !== null;

      // Default market per match: EXACT_SCORE titled "Predict the final score".
      // Idempotent via (matchId, type, title) unique key.
      const market = await prisma.betMarket.upsert({
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

      // Auto-settle if the fixture is FT and we have a score.
      if (justFinished) {
        try {
          // Only settle if not already settled.
          const fresh = await prisma.betMarket.findUnique({
            where: { id: market.id },
            select: { isSettled: true },
          });
          if (fresh && !fresh.isSettled) {
            await settleMarket({
              marketId: market.id,
              correctAnswer: `${f.goals.home}-${f.goals.away}`,
            });
            result.settledMarkets += 1;
          }
        } catch (e) {
          if (e instanceof SettleError) {
            // ALREADY_SETTLED is fine (race with manual settlement).
            if (e.message !== "ALREADY_SETTLED") {
              result.errors.push({
                apiMatchId,
                message: `settle: ${e.message}`,
              });
            }
          } else {
            result.errors.push({
              apiMatchId,
              message: `settle: ${(e as Error).message}`,
            });
          }
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
