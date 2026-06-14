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
  viewerBet: { predictedValue: string; pointsAwarded: number | null } | null;
  otherBets: FeedOtherBet[];
};

export type FeedMatch = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeCrest: string | null;
  awayCrest: string | null;
  kickoffTime: string; // ISO
  stage: string;
  status: string;
  // Raw status string from the provider (NS, 1H, HT, 2H, FT, AET, PEN).
  // MatchCard surfaces this prominently in the score row when
  // present (e.g. "HT 1-0", "2H 78'"), and falls back to a derived
  // "Final" / "Live" / kickoff-time label otherwise. Mirrors the
  // Match.externalStatus column populated by the football-data
  // ingest path.
  externalStatus: string | null;
  isLocked: boolean;
  timeUntilLockMs: number;
  homeScore: number | null;
  awayScore: number | null;
  homeHtGoals: number | null;
  awayHtGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  markets: FeedMarket[];
};

export type FeedPayload = {
  matches: FeedMatch[];
  serverNow: string; // ISO
  lockdownMs: number;
};

/**
 * Lazy flip: reveal bets whose underlying match has become locked
 * (5 min before kickoff) or has finished. Called at the start of
 * getGroupFeed so the visibility flag is fresh by the time we
 * build the feed.
 *
 * A single batched UPDATE statement scoped to the matches the
 * viewer is about to read — no global scan, no N+1. The WHERE
 * filter on isRevealed = false makes this idempotent.
 *
 * Outright markets (no matchId) are NOT touched here; the read
 * mask in the feed treats them as always revealed.
 */
async function revealBetsForLockedMatches(
  matches: { id: string; kickoffTime: Date; status: string }[],
  now: Date,
): Promise<void> {
  const lockedOrFinishedIds = matches
    .filter((m) => m.status === "FINISHED" || isLocked(m, now))
    .map((m) => m.id);
  if (lockedOrFinishedIds.length === 0) return;
  await prisma.$executeRaw`
    UPDATE "UserBet" ub
    SET "isRevealed" = true
    FROM "BetMarket" bm
    WHERE ub."marketId" = bm.id
      AND bm."matchId" = ANY(${lockedOrFinishedIds}::text[])
      AND ub."isRevealed" = false
  `;
}

/**
 * Group feed for a viewer. Applies the anti-snooping mask: any
 * UserBet whose owner is not the viewer is replaced with "🔒" if
 * the bet has not yet been revealed. The isRevealed flag is flipped
 * lazily (see revealBetsForLockedMatches) when the underlying match
 * becomes locked or finishes. Owner can always see their own picks.
 * Outright markets (no matchId) are always revealed.
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

  const now = new Date();
  const [matches, members, allBets] = await Promise.all([
    // Match.competitionId is the *primary vendor parent* (one-to-many);
    // a Match can additionally appear in many custom tournaments via
    // the CompetitionMatch join table. The feed must show ALL matches
    // linked to this group's competition, so the filter goes through
    // the m2m join (some: { competitionId }) rather than the typed
    // column. This is what makes mixed tournaments (a "Best of 2026"
    // competition that references matches from Premier League,
    // Champions League, etc.) surface on the group feed.
    prisma.match.findMany({
      where: {
        customLinks: { some: { competitionId: group.competitionId } },
      },
      // `include: { markets: true }` selects every column on Match by
      // default — so the new homeCrest / awayCrest columns are returned
      // for free, no explicit `select` needed.
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

  // NEW: lazy flip — reveal bets for matches that are locked or finished.
  // The flip is idempotent (only flips isRevealed: false → true).
  await revealBetsForLockedMatches(matches, now);

  const marketIds = matches.flatMap((m) => m.markets.map((mk) => mk.id));
  const allMarkets = matches.flatMap((m) => m.markets);
  const marketById = new Map(allMarkets.map((mk) => [mk.id, mk] as const));

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
          // Anti-snoop: foreign bets are masked until isRevealed = true.
          // isRevealed is flipped lazily by revealBetsForLockedMatches
          // when the underlying match becomes locked or finishes. Owner
          // can always see their own picks (handled by viewerBet above,
          // not here in otherBets). Outright markets (no matchId) are
          // always revealed.
          const market = marketById.get(bet.marketId);
          const isOutright = !market?.matchId;
          if (!bet.isRevealed && !isOutright) {
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
      stage: match.stage,
      status: match.status,
      externalStatus: match.externalStatus,
      isLocked: saveLocked,
      timeUntilLockMs,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      homeHtGoals: match.homeHtGoals,
      awayHtGoals: match.awayHtGoals,
      homePenalties: match.homePenalties,
      awayPenalties: match.awayPenalties,
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
