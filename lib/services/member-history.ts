import "server-only";
import { prisma } from "@/lib/prisma";
import { getStrategy } from "@/lib/scoring";
import type { ScoringConfig } from "@/lib/scoring/default-config";

export type MemberHistoryItem = {
  marketId: string;
  marketTitle: string;
  marketType: string;
  /** Raw predicted value when revealed or owner-viewing, "🔒" otherwise. */
  predictedValue: string;
  /** Whether the predictedValue is the actual pick or a mask. */
  isMasked: boolean;
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
 *
 * Anti-snoop: when the viewer is looking at ANOTHER member's history,
 * bets whose match hasn't started are masked to "🔒". The owner of the
 * bets can always see their own picks (via the same query — pass their
 * own userId as the viewerId).
 */
export async function getMemberHistory(
  groupId: string,
  targetUserId: string,
  viewerId: string,
): Promise<{
  member: { nickname: string; emoji: string; totalPoints: number };
  items: MemberHistoryItem[];
}> {
  const isSelf = targetUserId === viewerId;

  const [member, bets, allMarkets] = await Promise.all([
    prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: targetUserId, groupId } },
      include: { user: { select: { nickname: true, emoji: true } } },
    }),
    prisma.userBet.findMany({
      where: { groupId, userId: targetUserId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.betMarket.findMany({
      where: {
        userBets: { some: { userId: targetUserId, groupId } },
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
          scoringConfig: ({} as ScoringConfig),
          options: (m.options as string[] | null) ?? null,
        });
        breakdown = result.breakdown;
      } catch {
        breakdown = "Strategy not found";
      }
    }
    // Anti-snoop: hide foreign bets until availableFrom <= now.
    // availableFrom is set to match.kickoffTime at save time. Owner
    // can always see their own picks regardless of availableFrom.
    const masked = !isSelf && bet.availableFrom > new Date();
    return {
      marketId: bet.marketId,
      marketTitle: m?.title ?? "—",
      marketType: m?.type ?? "—",
      predictedValue: masked ? "🔒" : bet.predictedValue,
      isMasked: masked,
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
