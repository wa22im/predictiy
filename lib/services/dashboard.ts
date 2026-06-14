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
 * and the three most recent finished matches per group.
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
  //
  //    We `select` only the competition fields we need: `endDate`
  //    (typed column) and `details` (JSONB, carries
  //    `endDateWithGrace`). Full competition rows would pull a lot
  //    of extra columns we never read on the dashboard.
  const memberships = await prisma.groupMember.findMany({
    where: { userId: viewerId },
    include: {
      group: {
        include: {
          competition: {
            select: { id: true, name: true, endDate: true, details: true },
          },
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

  // 2. Filter for active competitions: manual groups (no competition)
  //    are always active. For linked competitions, prefer the JSONB
  //    `details.endDateWithGrace` (7-day grace period) over the
  //    typed `endDate` column. Falls back to the typed column when
  //    the JSONB field is absent or malformed — this is what
  //    classifyGroupArchive does, and the dashboard must agree so a
  //    group is "active" or "archived" consistently across the two
  //    read sites.
  const activeMemberships = memberships.filter((m) => {
    const comp = m.group.competition;
    if (!comp) return true; // manual group, always active
    const details = (comp.details as Record<string, unknown> | null) ?? {};
    const grace =
      typeof details.endDateWithGrace === "string"
        ? details.endDateWithGrace
        : null;
    const effective = grace ? new Date(grace) : comp.endDate;
    if (
      effective &&
      !isNaN(effective.getTime()) &&
      effective.getTime() <= now.getTime()
    ) {
      return false; // archived (past grace)
    }
    return true; // active
  });

  if (activeMemberships.length === 0) {
    return {
      groups: [],
      serverNow: now.toISOString(),
      lockdownMs: LOCKDOWN_MS,
    };
  }

  const activeGroupIds = activeMemberships.map((m) => m.group.id);
  // Manual groups (no linked competition) cannot have matches, so
  // they are excluded from the competitionId IN (...) lookup. The
  // match query would also be a no-op for them.
  const activeCompetitionIds = activeMemberships
    .map((m) => m.group.competition?.id)
    .filter((id): id is string => typeof id === "string");

  // 3. Fetch all relevant matches, all group members, and all user bets
  //    in parallel. The unsettled match query filters to non-FINISHED
  //    statuses (SCHEDULED | GOING); a SECOND query fetches recent
  //    FINISHED matches so the dashboard can prepend settled games
  //    (the "last settled" surface per principal direction). The
  //    all-members lookup and the user-bet lookup both use IN filters
  //    keyed on the active group ids so the database can serve the
  //    read in one round trip.
  //
  //    IMPORTANT: matches are linked to a competition through the
  //    CompetitionMatch m2m join (NOT through Match.competitionId,
  //    which is the *primary vendor parent*). A custom tournament
  //    can reference matches from any vendor; the join table is the
  //    union. The filter `customLinks: { some: { competitionId: { in } } }`
  //    is what makes mixed tournaments surface on the dashboard. We
  //    also `select: { competitionId: true }` on the customLinks
  //    relation so the per-group split below can match each match
  //    back to its parent competitions in O(1) — without that
  //    include, the downstream `match.customLinks.some(l => l.competitionId === compId)`
  //    check would have no relation data to inspect.
  const [allMatches, allGroupMembers, recentFinishedMatches] =
    await Promise.all([
      prisma.match.findMany({
        where: {
          customLinks: { some: { competitionId: { in: activeCompetitionIds } } },
          status: { in: ["SCHEDULED", "GOING"] },
        },
        include: {
          markets: true,
          customLinks: { select: { competitionId: true } },
        },
        orderBy: { kickoffTime: "desc" },
      }),
      prisma.groupMember.findMany({
        where: { groupId: { in: activeGroupIds } },
        include: {
          user: { select: { id: true, nickname: true, emoji: true } },
        },
        orderBy: { joinedAt: "asc" },
      }),
      // Recent FINISHED matches across all active competitions. We
      // cap at 50 globally (10 competitions × 5 per group) and slice
      // to 3 per group below. The take is intentionally loose: a
      // single user has at most a few active competitions, and the
      // dashboard's per-group cap (3) is much smaller than the fetch
      // size, so 50 covers any realistic scenario. A raw LIMIT would
      // require dropping into SQL; in-memory take is fine for this
      // surface.
      prisma.match.findMany({
        where: {
          customLinks: { some: { competitionId: { in: activeCompetitionIds } } },
          status: "FINISHED",
        },
        include: {
          markets: true,
          customLinks: { select: { competitionId: true } },
        },
        orderBy: { kickoffTime: "desc" },
        take: 50,
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

  // 4. Keep groups that have at least one unsettled OR one recent
  //    FINISHED match. Fully-settled competitions within the grace
  //    window still surface — the principal wants "always show the
  //    last settled games" on the dashboard. Manual groups (no
  //    competition) can never have matches on either side, so they
  //    are filtered out here (the `?.` keeps us safe when
  //    competition is null).
  //
  //    Per-group match attribution now uses the m2m join
  //    (match.customLinks.some(l => l.competitionId === compId))
  //    rather than the typed Match.competitionId column. The match
  //    can be in MANY competitions (custom tournaments), so we walk
  //    the link list.
  const groupsWithMatches = activeMemberships.filter((m) => {
    const compId = m.group.competition?.id;
    if (!compId) return false; // manual group
    const isInCompetition = (match: { customLinks: { competitionId: string }[] }) =>
      match.customLinks.some((l) => l.competitionId === compId);
    const hasUnsettled = allMatches.some(isInCompetition);
    const hasFinished = recentFinishedMatches.some(isInCompetition);
    return hasUnsettled || hasFinished;
  });

  // 5. Organize data into DashboardGroups
  const dashboardGroups: DashboardGroup[] = groupsWithMatches.map((m) => {
    const groupId = m.group.id;
    const compId = m.group.competition?.id;
    const isInCompetition = (match: { customLinks: { competitionId: string }[] }) =>
      match.customLinks.some((l) => l.competitionId === compId);
    const groupMatches = allMatches.filter(isInCompetition);
    // Filter the recent FINISHED fetch to this group's competition. The
    // join's competitionId is on the CompetitionMatch link; the per-group
    // competition id comes from the joined membership.
    const groupFinishedMatches = recentFinishedMatches.filter(isInCompetition);
    // Prefer the second groupMember call's result (the batched lookup).
    // Fall back to the nested include from the first call if the second
    // call returned nothing (e.g. test fixture doesn't set up the second
    // response). Both sources contain the same shape: group member rows
    // with the user nickname/emoji included.
    const groupMembers =
      membersByGroupId.get(groupId) ?? m.group.members ?? [];

    // The "always-10 format" — take as many unsettled as possible
    // (up to 7), then fill the remaining slots with the most-recent
    // settled games (up to 10 - unsettled). If there aren't enough
    // settled to fill to 10, show what's available (no padding).
    // The settled are PREPENDED at the top (most-recent first by
    // kickoffTime DESC), then the unsettled chronological past-first
    // (kickoffTime ASC, oldest first).
    // The user navigates to the group detail page for the full
    // chronological feed and the live-updating settled list.
    //
    // Source split:
    //   - `groupMatches` already filters out FINISHED (the unsettled
    //     query excludes status: "FINISHED" at the DB level).
    //   - `groupFinishedMatches` is the slice of the second query for
    //     this group's competition, sorted DESC by kickoffTime.
    // We still defensively filter by status here so the split is
    // robust to future data sources (e.g. a cache layer that returns
    // a mixed bag).
    const unsettledMatches = groupMatches
      .filter((match) => match.status !== "FINISHED")
      .sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime());

    // Combine the in-group FINISHED matches (defensive: should be
    // empty given the query filter, but the union keeps the split
    // self-correcting) with the recent-FINISHED fetch. The fetch is
    // already sorted DESC, so the combined list is sorted DESC too.
    const finishedMatches = [
      ...groupMatches.filter((match) => match.status === "FINISHED"),
      ...groupFinishedMatches,
    ].sort((a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime());

    // Always-10 algorithm: cap unsettled at 7, then fill the gap
    // with the most-recent settled games up to (10 - unsettled). If
    // unsettled < 7, settled count = 10 - unsettled (capped at
    // finished.length). Total surface is min(10, unsettled + finished);
    // if there aren't enough matches we show what's available — the
    // dashboard never shows > 10.
    const unsettledCount = Math.min(unsettledMatches.length, 7);
    const settledCount = Math.min(
      finishedMatches.length,
      10 - unsettledCount,
    );
    const cappedUnsettled = unsettledMatches.slice(0, unsettledCount);
    const latestFinished = finishedMatches.slice(0, settledCount);
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
