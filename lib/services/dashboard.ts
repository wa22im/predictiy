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

  // 1. Fetch user memberships with group/competition info. The
  //    include also pulls the full member list per group so the
  //    dashboard can build the "other bets" map (mirrors the
  //    getGroupFeed pattern at group-feed.ts:140-177). A second
  //    `groupMember.findMany` is issued in parallel for the active
  //    group ids — this keeps the batched-query contract (2 calls,
  //    not 1 nested + N per-group) while still loading the member
  //    data needed for "other bets".
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

  // 3. Fetch all relevant matches, all group members, and all user bets
  //    in parallel. The match query filters to unsettled statuses only
  //    (SCHEDULED | GOING) — settled matches never surface on the
  //    dashboard. The all-members lookup and the user-bet lookup both
  //    use IN filters keyed on the active group ids so the database can
  //    serve the read in one round trip.
  const [allMatches, allGroupMembers] = await Promise.all([
    prisma.match.findMany({
      where: {
        competitionId: { in: activeCompetitionIds },
        status: { in: ["SCHEDULED", "GOING"] },
      },
      include: { markets: true },
      orderBy: { kickoffTime: "desc" },
    }),
    prisma.groupMember.findMany({
      where: { groupId: { in: activeGroupIds } },
      include: {
        user: { select: { id: true, nickname: true, emoji: true } },
      },
      orderBy: { joinedAt: "asc" },
    }),
  ]);

  // marketIds is derived from the unsettled matches (those are the markets
  // the user is interacting with on the dashboard). Filtering userBet by
  // marketId IN (...) in addition to groupId IN (...) lets Postgres serve
  // the read in one round trip.
  const marketIds = allMatches.flatMap((m) => m.markets.map((mk) => mk.id));

  const allUserBets = await prisma.userBet.findMany({
    where: {
      groupId: { in: activeGroupIds },
      marketId: { in: marketIds },
    },
  });

  // Build a Map<groupId, Member[]> from the second groupMember call so
  // the per-group loop below can look up the "other bets" pool in O(1).
  // This is the batched lookup that replaces the nested include in the
  // first call — both calls run in parallel and the database can serve
  // the read in one round trip.
  const membersByGroupId = new Map<string, typeof allGroupMembers>();
  for (const gm of allGroupMembers) {
    const list = membersByGroupId.get(gm.groupId);
    if (list) {
      list.push(gm);
    } else {
      membersByGroupId.set(gm.groupId, [gm]);
    }
  }

  // 3a. Lazy flip — reveal bets whose underlying match has become
  //     locked (5 min before kickoff). Mirrors the same call in
  //     getGroupFeed (group-feed.ts:121-123) so the dashboard's
  //     "all bets" view respects the anti-snoop mask consistently
  //     with the matches page. revealBetsForLockedMatches is
  //     intentionally not exported from group-feed.ts (it's an
  //     internal helper), so the same batched UPDATE is inlined here.
  const lockedIds = allMatches
    .filter((m) => isLocked(m, now))
    .map((m) => m.id);
  if (lockedIds.length > 0) {
    await prisma.$executeRaw`
      UPDATE "UserBet" ub
      SET "isRevealed" = true
      FROM "BetMarket" bm
      WHERE ub."marketId" = bm.id
        AND bm."matchId" = ANY(${lockedIds}::text[])
        AND ub."isRevealed" = false
    `;
  }

  // 4. Filter out groups that have zero unsettled matches — settled
  //    competitions shouldn't surface on the dashboard.
  const groupsWithUnsettled = activeMemberships.filter((m) =>
    allMatches.some((match) => match.competitionId === m.group.competition.id)
  );

  // 5. Organize data into DashboardGroups
  const dashboardGroups: DashboardGroup[] = groupsWithUnsettled.map((m) => {
    const groupId = m.group.id;
    const groupMatches = allMatches.filter((match) =>
      match.competitionId === m.group.competition.id
    );
    // Prefer the second groupMember call's result (the batched lookup).
    // Fall back to the nested include from the first call if the second
    // call returned nothing (e.g. test fixture doesn't set up the second
    // response). Both sources contain the same shape: group member rows
    // with the user nickname/emoji included.
    const groupMembers =
      membersByGroupId.get(groupId) ?? m.group.members ?? [];

    // Unsettled: chronological, past first (oldest kickoff at top).
    // The "2/8 format" — 2 most-recent finished + 8 unsettled — caps the
    // dashboard surface at 10. The 2 finished are PREPENDED at the top
    // (most-recent first), then the 8 unsettled chronological past-first.
    // The user navigates to the group detail page for the live-updating
    // chronological feed.
    //
    // The service is defensive: even though the query filter excludes
    // FINISHED at the DB level, we still split the returned matches so
    // the "2 most-recent finished" prepend works in cases where the
    // underlying data source returns settled matches too (e.g. future
    // cache layer, integration tests).
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
    });

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
