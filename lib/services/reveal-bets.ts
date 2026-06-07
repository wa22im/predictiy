import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Lazy reveal: any UserBet whose market's match kickoffTime has passed
 * is flipped to isRevealed = true. Idempotent — re-running is a no-op
 * once all eligible bets are revealed. Safe to call on every read.
 *
 * Anti-snooping: foreign bets stay hidden until the match starts.
 * Once revealed, the value is permanently visible to all group members.
 */
export async function revealBetsForStartedMatches(): Promise<number> {
  const result = await prisma.userBet.updateMany({
    where: {
      isRevealed: false,
      market: {
        match: {
          kickoffTime: { lte: new Date() },
        },
      },
    },
    data: { isRevealed: true },
  });
  return result.count;
}

/**
 * Reveal bets within a single group only. Used by the per-group feed
 * and member-history reads so we don't have to scan the whole table.
 */
export async function revealBetsForGroup(groupId: string): Promise<number> {
  const result = await prisma.userBet.updateMany({
    where: {
      groupId,
      isRevealed: false,
      market: {
        match: {
          kickoffTime: { lte: new Date() },
        },
      },
    },
    data: { isRevealed: true },
  });
  return result.count;
}
