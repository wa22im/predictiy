import "server-only";
import { prisma } from "@/lib/prisma";
import { isLocked, LOCKDOWN_MS } from "@/lib/time";
import { FeedMarket, type FeedOtherBet } from "./group-feed";

export type DashboardMatch = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeCrest: string | null;
  awayCrest: string | null;
  kickoffTime: string;
  status: string;
  isLocked: boolean;
  markets: FeedMarket[];
  isFinished: boolean;
  homeScore: number | null;
  awayScore: number | null;
  homeHtGoals: number | null;
  awayHtGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  stage: string;
  timeUntilLockMs: number;
};

export type DashboardGroup = {
  id: string;
  name: string;
  competitionName: string;
  memberCount: number;
  matches: DashboardMatch[];
};

export type DashboardPayload = {
  groups: DashboardGroup[];
  serverNow: string;
  lockdownMs: number;
};

/**
 * Optimized dashboard data fetcher.
 * Fetches groups with active (unexpired) competitions, their unsettled matches,
 * and the two most recent finished matches.
 */
export async function getDashboardData(viewerId: string): Promise<DashboardPayload> {
  const now = new Date();

  // 1. Fetch user memberships and their group/competition info.
  //    The include also pulls the full member list per group so the
  //    dashboard can build the "other bets" map (mirrors the
  //    getGroupFeed pattern at group-feed.ts:140-177). Without this
  //    we'd have to issue a second groupMember.findMany per group,
  //    turning 1 query into N+1.
  const memberships = await prisma.groupMember.findMany({
    where: { userId: viewerId },
    include: {
      group: {
        include: {
          competition: true,
          _count: { select: { members: true } },
          members: {
            include: {
              user: { select: { id: true, nickname: true, emoji: true } },
            },
            orderBy: { joinedAt: "asc" },
          },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  if (memberships.length === 0) {
    return {
      groups: [],
      serverNow: now.toISOString(),
      lockdownMs: LOCKDOWN_MS,
    };
  }

  // 2. Filter for active competitions (endDate > now)
  const activeMemberships = memberships.filter(
    (m) => !m.group.competition.endDate || m.group.competition.endDate > now
  );

  if (activeMemberships.length === 0) {
    return {
      groups: [],
      serverNow: now.toISOString(),
      lockdownMs: LOCKDOWN_MS,
    };
  }

  const activeGroupIds = activeMemberships.map((m) => m.group.id);
  const activeCompetitionIds = activeMemberships.map(
    (m) => m.group.competition.id
  );

  // 3. Fetch all relevant matches and all user bets for these groups in parallel
  const [allMatches, allUserBets] = await Promise.all([
    prisma.match.findMany({
      where: {
        competitionId: { in: activeCompetitionIds },
        status: { in: ["SCHEDULED", "GOING", "FINISHED"] },
      },
      include: { markets: true },
      orderBy: { kickoffTime: "desc" },
    }),
    prisma.userBet.findMany({
      where: { groupId: { in: activeGroupIds } },
    }),
  ]);

  // 3a. Lazy flip — reveal bets whose underlying match has become
  //     locked (5 min before kickoff) or has finished. Mirrors the
  //     same call in getGroupFeed (group-feed.ts:121-123) so the
  //     dashboard's "all bets" view respects the anti-snoop mask
  //     consistently with the matches page. revealBetsForLockedMatches
  //     is intentionally not exported from group-feed.ts (it's an
  //     internal helper), so the same batched UPDATE is inlined here.
  const lockedOrFinishedIds = allMatches
    .filter((m) => m.status === "FINISHED" || isLocked(m, now))
    .map((m) => m.id);
  if (lockedOrFinishedIds.length > 0) {
    await prisma.$executeRaw`
      UPDATE "UserBet" ub
      SET "isRevealed" = true
      FROM "BetMarket" bm
      WHERE ub."marketId" = bm.id
        AND bm."matchId" = ANY(${lockedOrFinishedIds}::text[])
        AND ub."isRevealed" = false
    `;
  }

  // 4. Organize data into DashboardGroups
  const dashboardGroups: DashboardGroup[] = activeMemberships.map((m) => {
    const groupId = m.group.id;
    const groupMatches = allMatches.filter((match) =>
      match.competitionId === m.group.competition.id
    );
    const groupMembers = m.group.members;

    // Separate unsettled and finished matches.
    //
    // Unsettled: chronological, past first (oldest kickoff at top).
    // The "2/8 format" — 2 most-recent finished + 8 unsettled — caps the
    // dashboard surface at 10. The 2 finished are PREPENDED at the top
    // (most-recent first), then the 8 unsettled chronological past-first.
    // The user navigates to the group detail page for the live-updating
    // chronological feed.
    const unsettledMatches = groupMatches
      .filter((match) => match.status !== "FINISHED")
      .sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime());

    const finishedMatches = groupMatches
      .filter((match) => match.status === "FINISHED")
      .sort((a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime());

    // Cap the dashboard surface to at most 10 matches per group:
    //   - 2 most-recent finished (prepended at top)
    //   - up to 8 unsettled (sorted chronologically, past first)
    // The user navigates to the group detail page for the full list; the
    // dashboard is a quick-glance summary.
    const cappedUnsettled = unsettledMatches.slice(0, 8);
    const latestFinished = finishedMatches.slice(0, 2);
    const combinedMatches = [...latestFinished, ...cappedUnsettled].map(
      (match) => {
        // Find bets for this match in this group
        const matchMarkets = match.markets.map((market) => {
          const viewerBet = allUserBets.find(
            (bet) =>
              bet.groupId === groupId &&
              bet.marketId === market.id &&
              bet.userId === viewerId
          );

          // Per-market "other bets" — mirror of getGroupFeed
          // (group-feed.ts:140-177). Excludes the viewer, masks
          // unrevealed bets as 🔒. Outright markets (no matchId) are
          // always revealed by the same convention.
          const marketById = new Map(
            match.markets.map((mk) => [mk.id, mk] as const),
          );
          const otherBets: FeedOtherBet[] = groupMembers
            .filter((gm) => gm.userId !== viewerId)
            .map((gm) => {
              const bet = allUserBets.find(
                (b) =>
                  b.groupId === groupId &&
                  b.marketId === market.id &&
                  b.userId === gm.userId,
              );
              if (!bet) {
                return {
                  userId: gm.userId,
                  nickname: gm.user.nickname,
                  emoji: gm.user.emoji,
                  predictedValue: "—",
                  isMasked: false,
                };
              }
              const isOutright = !marketById.get(bet.marketId)?.matchId;
              if (!bet.isRevealed && !isOutright) {
                return {
                  userId: gm.userId,
                  nickname: gm.user.nickname,
                  emoji: gm.user.emoji,
                  predictedValue: "🔒",
                  isMasked: true,
                };
              }
              return {
                userId: gm.userId,
                nickname: gm.user.nickname,
                emoji: gm.user.emoji,
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
            viewerBet: viewerBet
              ? {
                  predictedValue: viewerBet.predictedValue,
                  pointsAwarded: viewerBet.pointsAwarded,
                }
              : null,
            otherBets,
          };
        });

        return {
          id: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeCrest: match.homeCrest,
          awayCrest: match.awayCrest,
          kickoffTime: match.kickoffTime.toISOString(),
          status: match.status,
          isLocked: match.status !== "FINISHED" && isLocked({ kickoffTime: match.kickoffTime }, now),
          markets: matchMarkets,
          isFinished: match.status === "FINISHED",
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          homeHtGoals: match.homeHtGoals,
          awayHtGoals: match.awayHtGoals,
          homePenalties: match.homePenalties,
          awayPenalties: match.awayPenalties,
          stage: match.stage,
          timeUntilLockMs: Math.max(0, match.kickoffTime.getTime() - LOCKDOWN_MS - now.getTime()),
        };
      }
    );

    return {
      id: groupId,
      name: m.group.name,
      competitionName: m.group.competition.name,
      memberCount: m.group._count.members,
      matches: combinedMatches,
    };
  });

  return {
    groups: dashboardGroups,
    serverNow: now.toISOString(),
    lockdownMs: LOCKDOWN_MS,
  };
}
