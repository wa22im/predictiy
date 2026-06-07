import "server-only";
import { prisma } from "@/lib/prisma";
import { isLocked, LOCKDOWN_MS } from "@/lib/time";

export type FeedOtherBet = {
  userId: string;
  nickname: string;
  emoji: string;
  predictedValue: string; // "🔒" when masked
  isMasked: boolean;
};

export type FeedMarket = {
  id: string;
  type: string;
  title: string;
  options: string[] | null;
  correctAnswer: string | null;
  isSettled: boolean;
  viewerBet: { predictedValue: string } | null;
  otherBets: FeedOtherBet[];
};

export type FeedMatch = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string; // ISO
  stage: string;
  status: string;
  isLocked: boolean;
  timeUntilLockMs: number;
  markets: FeedMarket[];
};

export type FeedPayload = {
  matches: FeedMatch[];
  serverNow: string; // ISO
  lockdownMs: number;
};

/**
 * Group feed for a viewer. Applies the anti-snooping mask: any
 * UserBet whose owner is not the viewer is replaced with "🔒" if
 * the match is in the lockdown window. Once the match is settled
 * (status = FINISHED), all bets become visible.
 */
export async function getGroupFeed(
  groupId: string,
  viewerId: string,
): Promise<FeedPayload> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, competitionId: true },
  });
  if (!group) {
    throw new Error("GROUP_NOT_FOUND");
  }

  const [matches, members, allBets] = await Promise.all([
    prisma.match.findMany({
      where: { competitionId: group.competitionId },
      include: { markets: true },
      orderBy: { kickoffTime: "asc" },
    }),
    prisma.groupMember.findMany({
      where: { groupId },
      include: {
        user: { select: { id: true, nickname: true, emoji: true } },
      },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.userBet.findMany({ where: { groupId } }),
  ]);

  const now = new Date();
  const marketIds = matches.flatMap((m) => m.markets.map((mk) => mk.id));

  const feedMatches: FeedMatch[] = matches.map((match) => {
    const settled = match.status === "FINISHED";
    const saveLocked = !settled && isLocked({ kickoffTime: match.kickoffTime }, now);
    const timeUntilLockMs = settled
      ? 0
      : Math.max(0, match.kickoffTime.getTime() - LOCKDOWN_MS - now.getTime());

    const feedMarkets: FeedMarket[] = match.markets.map((market) => {
      const marketBets = allBets.filter((b) => b.marketId === market.id);
      const viewerBet = marketBets.find((b) => b.userId === viewerId);

      const otherBets: FeedOtherBet[] = members
        .filter((m) => m.userId !== viewerId)
        .map((m) => {
          const bet = marketBets.find((b) => b.userId === m.userId);
          if (!bet) {
            return {
              userId: m.userId,
              nickname: m.user.nickname,
              emoji: m.user.emoji,
              predictedValue: "—",
              isMasked: false,
            };
          }
          // Anti-snoop: foreign bets are masked until availableFrom <= now.
          // availableFrom is set to match.kickoffTime at first save, so
          // this is equivalent to "hide until kickoff". Stored on the
          // row, queried directly — no lazy update needed.
          if (bet.availableFrom > now) {
            return {
              userId: m.userId,
              nickname: m.user.nickname,
              emoji: m.user.emoji,
              predictedValue: "🔒",
              isMasked: true,
            };
          }
          return {
            userId: m.userId,
            nickname: m.user.nickname,
            emoji: m.user.emoji,
            predictedValue: bet.predictedValue,
            isMasked: false,
          };
        });

      return {
        id: market.id,
        type: market.type,
        title: market.title,
        options: (market.options as string[] | null) ?? null,
        correctAnswer: market.correctAnswer,
        isSettled: market.isSettled,
        viewerBet: viewerBet ? { predictedValue: viewerBet.predictedValue } : null,
        otherBets,
      };
    });

    return {
      id: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffTime: match.kickoffTime.toISOString(),
      stage: match.stage,
      status: match.status,
      isLocked: saveLocked,
      timeUntilLockMs,
      markets: feedMarkets,
    };
  });

  // Suppress the eslint unused-var check (marketIds is useful for ad-hoc queries)
  void marketIds;

  return {
    matches: feedMatches,
    serverNow: now.toISOString(),
    lockdownMs: LOCKDOWN_MS,
  };
}
