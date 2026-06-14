import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type { CompetitionSyncPayload } from "@/lib/validation/admin";

export type SyncResult = {
  competitionId: string;
  created: { matches: number; markets: number };
  updated: { matches: number; markets: number };
  errors: { apiMatchId?: string; message: string }[];
};

/**
 * Idempotent competition sync.
 * - Upserts the competition by name (no-op if it already exists).
 * - Upserts each match by apiMatchId (global uniqueness).
 * - Upserts each market by (matchId, type, title).
 * - Never deletes: rows are preserved so UserBet references stay valid.
 */
export async function syncCompetition(
  payload: CompetitionSyncPayload,
): Promise<SyncResult> {
  const competition = await prisma.competition.upsert({
    where: { name: payload.competition.name },
    update: {},
    create: { name: payload.competition.name },
  });

  let createdMatches = 0;
  let updatedMatches = 0;
  let createdMarkets = 0;
  let updatedMarkets = 0;
  const errors: SyncResult["errors"] = [];

  for (const m of payload.matches) {
    try {
      const existing = await prisma.match.findUnique({
        where: { apiMatchId: m.apiMatchId },
      });

      const match = await prisma.match.upsert({
        where: { apiMatchId: m.apiMatchId },
        update: {
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          kickoffTime: new Date(m.kickoffTime),
          stage: m.stage,
          homeCrest: m.homeCrest ?? null,
          awayCrest: m.awayCrest ?? null,
          competitionId: competition.id,
        },
        create: {
          competitionId: competition.id,
          apiMatchId: m.apiMatchId,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          kickoffTime: new Date(m.kickoffTime),
          stage: m.stage,
          homeCrest: m.homeCrest ?? null,
          awayCrest: m.awayCrest ?? null,
        },
      });

      // Link this match to its parent competition via the
      // CompetitionMatch join table. The match's primary vendor
      // parent is still `Match.competitionId` (typed FK, used for
      // the cron's read paths); the join row is what powers the
      // cross-tournament / mixed-tournament queries. We use upsert
      // with an empty `update` block so re-running this function is
      // a no-op for the join table.
      await prisma.competitionMatch.upsert({
        where: {
          matchId_competitionId: {
            matchId: match.id,
            competitionId: competition.id,
          },
        },
        create: { matchId: match.id, competitionId: competition.id },
        update: {},
      });

      if (existing) updatedMatches += 1;
      else createdMatches += 1;

      for (const mk of m.markets) {
        const existingMarket = await prisma.betMarket.findUnique({
          where: {
            matchId_type_title: {
              matchId: match.id,
              type: mk.type,
              title: mk.title,
            },
          },
        });

        await prisma.betMarket.upsert({
          where: {
            matchId_type_title: {
              matchId: match.id,
              type: mk.type,
              title: mk.title,
            },
          },
          update: {
            options: mk.options ? (mk.options as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
          create: {
            matchId: match.id,
            type: mk.type,
            title: mk.title,
            options: mk.options ? (mk.options as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
        });

        if (existingMarket) updatedMarkets += 1;
        else createdMarkets += 1;
      }
    } catch (e) {
      errors.push({ apiMatchId: m.apiMatchId, message: (e as Error).message });
    }
  }

  return {
    competitionId: competition.id,
    created: { matches: createdMatches, markets: createdMarkets },
    updated: { matches: updatedMatches, markets: updatedMarkets },
    errors,
  };
}
