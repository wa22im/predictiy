import "server-only";
import { prisma } from "@/lib/prisma";
import { getStrategy } from "@/lib/scoring";
import type { ScoringConfig } from "@/lib/scoring/default-config";

export type MemberHistoryItem = {
  marketId: string;
  marketTitle: string;
  marketType: string;
  predictedValue: string;
  correctAnswer: string | null;
  points: number;
  breakdown: string;
  isSettled: boolean;
  matchId: string | null;
  matchLabel: string | null;
  kickoffTime: string | null;
};

/**
 * Per-member history within a group. Re-runs the strategy to compute
 * the breakdown string (we don't persist the breakdown, only the points).
 */
export async function getMemberHistory(
  groupId: string,
  userId: string,
): Promise<{
  member: { nickname: string; emoji: string; totalPoints: number };
  items: MemberHistoryItem[];
}> {
  const [member, bets, allMarkets] = await Promise.all([
    prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { user: { select: { nickname: true, emoji: true } } },
    }),
    prisma.userBet.findMany({
      where: { groupId, userId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.betMarket.findMany({
      where: {
        userBets: { some: { userId, groupId } },
      },
      include: { match: true },
    }),
  ]);

  if (!member) {
    throw new Error("MEMBER_NOT_FOUND");
  }

  const marketMap = new Map(allMarkets.map((m) => [m.id, m]));
  const items: MemberHistoryItem[] = bets.map((bet) => {
    const m = marketMap.get(bet.marketId);
    const points = bet.pointsAwarded ?? 0;
    let breakdown = "Pending settlement";
    if (m?.isSettled && m.correctAnswer) {
      try {
        const result = getStrategy(m.type).score({
          predictedValue: bet.predictedValue,
          correctAnswer: m.correctAnswer,
          marketType: m.type,
          matchStage: m.match?.stage ?? "OUTRIGHT",
          scoringConfig: (member as unknown as { scoringConfig?: ScoringConfig })
            .scoringConfig ?? ({} as ScoringConfig),
          options: (m.options as string[] | null) ?? null,
        });
        breakdown = result.breakdown;
      } catch {
        breakdown = "Strategy not found";
      }
    }
    return {
      marketId: bet.marketId,
      marketTitle: m?.title ?? "—",
      marketType: m?.type ?? "—",
      predictedValue: bet.predictedValue,
      correctAnswer: m?.correctAnswer ?? null,
      points,
      breakdown,
      isSettled: m?.isSettled ?? false,
      matchId: m?.matchId ?? null,
      matchLabel: m?.match
        ? `${m.match.homeTeam} vs ${m.match.awayTeam}`
        : null,
      kickoffTime: m?.match?.kickoffTime.toISOString() ?? null,
    };
  });

  const totalPoints = items.reduce((acc, i) => acc + i.points, 0);

  return {
    member: {
      nickname: member.user.nickname,
      emoji: member.user.emoji,
      totalPoints,
    },
    items,
  };
}
