import "server-only";
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

  const strategy = getStrategy(market.type);
  const stage = market.match?.stage ?? "OUTRIGHT";
  const byGroupMap = new Map<string, SettleByGroup>();
  let scoredRows = 0;

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

    await prisma.userBet.update({
      where: { id: bet.id },
      data: { pointsAwarded: result.points },
    });

    scoredRows += 1;
    const existing = byGroupMap.get(bet.groupId);
    if (existing) {
      existing.scoredRows += 1;
      existing.totalPoints += result.points;
    } else {
      byGroupMap.set(bet.groupId, {
        groupId: bet.groupId,
        groupName: bet.group.name,
        scoredRows: 1,
        totalPoints: result.points,
      });
    }
  }

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
