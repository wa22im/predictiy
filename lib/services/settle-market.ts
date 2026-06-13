import "server-only";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getStrategy } from "@/lib/scoring";
import type { ScoringConfig } from "@/lib/scoring/default-config";

export type SettleInput = {
  marketId: string;
  correctAnswer: string;
};

export type SettleByGroup = {
  groupId: string;
  groupName: string;
  scoredRows: number;
  totalPoints: number;
};

export type SettleResult = {
  marketId: string;
  marketType: string;
  correctAnswer: string;
  scoredRows: number;
  byGroup: SettleByGroup[];
};

export class SettleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SettleError";
  }
}

export async function settleMarket(input: SettleInput): Promise<SettleResult> {
  const market = await prisma.betMarket.findUnique({
    where: { id: input.marketId },
    include: { match: true },
  });
  if (!market) {
    throw new SettleError(404, "MARKET_NOT_FOUND");
  }
  if (market.isSettled) {
    throw new SettleError(409, "ALREADY_SETTLED");
  }
  if (!input.correctAnswer.trim()) {
    throw new SettleError(400, "Correct answer is required");
  }

  // 1. Update the market
  await prisma.betMarket.update({
    where: { id: market.id },
    data: {
      correctAnswer: input.correctAnswer.trim(),
      isSettled: true,
    },
  });

  // 2. If anchored to a match, mark the match FINISHED
  if (market.match) {
    await prisma.match.update({
      where: { id: market.match.id },
      data: { status: "FINISHED" },
    });
  }

  // 3. Pull all bets across every group in the competition
  const bets = await prisma.userBet.findMany({
    where: { marketId: market.id },
    include: { group: { select: { id: true, name: true, scoringConfig: true } } },
  });

  const stage = market.match?.stage ?? "OUTRIGHT";
  const byGroupMap = new Map<string, SettleByGroup>();
  let scoredRows = 0;

  // Look up a scoring strategy. If the market type is not in the
  // registry (e.g. a legacy row whose market type was removed in a
  // later redesign), log a warning and skip the scoring loop. The
  // market is still marked settled + correctAnswer is preserved; only
  // the per-bet pointsAwarded is not updated.
  let strategy: ReturnType<typeof getStrategy> | null = null;
  try {
    strategy = getStrategy(market.type);
  } catch (e) {
    console.warn(
      `[settleMarket] No scoring strategy for market type ${market.type} ` +
        `(marketId=${market.id}); skipping scoring loop. ` +
        `Likely a legacy row predating a market redesign. ` +
        `Error: ${(e as Error).message}`,
    );
  }

  if (strategy) {
    for (const bet of bets) {
      const scoringConfig = bet.group.scoringConfig as unknown as ScoringConfig;
      const result = strategy.score({
        predictedValue: bet.predictedValue,
        correctAnswer: input.correctAnswer.trim(),
        marketType: market.type,
        matchStage: stage,
        scoringConfig,
        options: (market.options as string[] | null) ?? null,
      });

      // Per-bet floor: no individual bet ever costs the user more than
      // -1 point, regardless of what the strategy returns. This is the
      // single source of truth for the floor — strategies can return
      // their natural values (-2, +2, +3, etc.) and we clamp here so
      // we never double-clamp or behave inconsistently.
      const clampedPoints = Math.max(-1, result.points);

      await prisma.userBet.update({
        where: { id: bet.id },
        data: { pointsAwarded: clampedPoints },
      });

      scoredRows += 1;
      const existing = byGroupMap.get(bet.groupId);
      if (existing) {
        existing.scoredRows += 1;
        existing.totalPoints += clampedPoints;
      } else {
        byGroupMap.set(bet.groupId, {
          groupId: bet.groupId,
          groupName: bet.group.name,
          scoredRows: 1,
          totalPoints: clampedPoints,
        });
      }
    }
  }

  // Invalidate the leaderboard cache so all affected groups'
  // leaderboards are refetched on next request. The cache uses a
  // single global tag ("group-leaderboard"); a settle invalidates
  // every group's leaderboard entry at once. This is mild
  // over-invalidation, but settles are infrequent (only when an
  // admin marks a market settled) and the leaderboard data set is
  // small. Per-group tags would require a per-group cache function
  // (unstable_cache does not accept dynamic tag lists), which adds
  // complexity for marginal benefit.
  revalidateTag("group-leaderboard");

  return {
    marketId: market.id,
    marketType: market.type,
    correctAnswer: input.correctAnswer.trim(),
    scoredRows,
    byGroup: Array.from(byGroupMap.values()).sort(
      (a, b) => b.totalPoints - a.totalPoints,
    ),
  };
}
