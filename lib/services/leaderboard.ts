import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

export type LeaderboardEntry = {
  userId: string;
  nickname: string;
  emoji: string;
  totalPoints: number;
  settledBets: number;
  rank: number;
};

/**
 * Public entry point — thin wrapper around the cached implementation.
 * The per-group cache key is derived from `groupId` automatically
 * (unstable_cache appends function args to the keyParts). The
 * 1-hour revalidate is a safety TTL; the cache is invalidated
 * explicitly on every settle via revalidateTag("group-leaderboard").
 *
 * Note: the cache tag is intentionally global (not per-group) so that
 * a single settle can invalidate all affected groups in one call
 * without needing to know which groups changed. This is mild
 * over-invalidation, but settles are infrequent (only when an admin
 * marks a market settled) and the leaderboard data set is small.
 * Per-group tags would require a per-group cache function
 * (unstable_cache does not accept dynamic tag lists), which adds
 * complexity for marginal benefit.
 */
export async function getGroupLeaderboard(
  groupId: string,
): Promise<LeaderboardEntry[]> {
  return _getCachedGroupLeaderboard(groupId);
}

const _getCachedGroupLeaderboard = unstable_cache(
  async (groupId: string): Promise<LeaderboardEntry[]> => {
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
  },
  ["group-leaderboard"],
  {
    revalidate: 3600,
    tags: ["group-leaderboard"],
  },
);
