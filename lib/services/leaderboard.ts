import "server-only";
import { prisma } from "@/lib/prisma";

export type LeaderboardEntry = {
  userId: string;
  nickname: string;
  emoji: string;
  totalPoints: number;
  settledBets: number;
  rank: number;
};

export async function getGroupLeaderboard(
  groupId: string,
): Promise<LeaderboardEntry[]> {
  const [members, settledBets] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId },
      include: {
        user: { select: { id: true, nickname: true, emoji: true } },
      },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.userBet.findMany({
      where: { groupId, pointsAwarded: { not: null } },
      select: { userId: true, pointsAwarded: true },
    }),
  ]);

  const totals = new Map<string, { totalPoints: number; settledBets: number }>();
  for (const b of settledBets) {
    const t = totals.get(b.userId) ?? { totalPoints: 0, settledBets: 0 };
    t.totalPoints += b.pointsAwarded ?? 0;
    t.settledBets += 1;
    totals.set(b.userId, t);
  }

  const entries: LeaderboardEntry[] = members.map((m) => {
    const t = totals.get(m.userId) ?? { totalPoints: 0, settledBets: 0 };
    return {
      userId: m.userId,
      nickname: m.user.nickname,
      emoji: m.user.emoji,
      totalPoints: t.totalPoints,
      settledBets: t.settledBets,
      rank: 0,
    };
  });

  entries.sort((a, b) => b.totalPoints - a.totalPoints);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return entries;
}
