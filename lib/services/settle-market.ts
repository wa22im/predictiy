import "server-only";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { getStrategy } from "@/lib/scoring";
import type { ScoringConfig } from "@/lib/scoring/default-config";

export type SettleInput = {
  marketId: string;
  correctAnswer: string;
};

export type SettleByGroup = {
  groupId: string;
  groupName: string;
  scoredRows: number;
  totalPoints: number;
};

export type SettleResult = {
  marketId: string;
  marketType: string;
  correctAnswer: string;
  scoredRows: number;
  byGroup: SettleByGroup[];
};

export class SettleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SettleError";
  }
}

// Prisma error codes that indicate a transient infrastructure error
// (DB connection issue, timeout, deadlock). These warrant a retry.
//   P1001 — Can't reach database server
//   P1002 — Database server timed out
//   P1008 — Operations timed out
//   P2034 — Write conflict / deadlock detected
const TRANSIENT_PRISMA_ERROR_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P2034",
]);

/**
 * Returns true for Prisma errors that are safe to retry.
 *
 * - `PrismaClientKnownRequestError` with a known-transient code
 *   (connection, timeout, deadlock) → retry.
 * - `PrismaClientUnknownRequestError` → retry as a safety net. These
 *   are often transient (network blip, serverless cold start,
 *   mid-deploy). They re-throw after the retry budget is exhausted.
 * - Anything else → do not retry.
 */
export function isTransientPrismaError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_ERROR_CODES.has(e.code);
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError) {
    return true;
  }
  return false;
}

/**
 * Backoff schedule for transient-error retries. Index 0 is the wait
 * after the first failed attempt, index 1 after the second, etc.
 *
 * Total attempts = 1 (initial) + SETTLE_RETRY_BACKOFFS_MS.length (3 retries)
 * = 4 attempts maximum.
 */
export const SETTLE_RETRY_BACKOFFS_MS = [1000, 1500, 3000] as const;

/**
 * Number of bet IDs batched per `tx.userBet.updateMany` call during
 * settlement. Bets are first grouped by their computed
 * `pointsAwarded` value, then each group is split into chunks of
 * `SETTLE_CHUNK_SIZE` IDs and one `updateMany` is issued per chunk.
 * This keeps the per-transaction round-trip count manageable while
 * preserving the atomicity guarantee from the `$transaction` wrapper.
 */
export const SETTLE_CHUNK_SIZE = 100;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Settle a bet market: mark it settled, score every bet across every
 * group in the competition, and invalidate the leaderboard cache.
 *
 * All reads + writes go through one interactive transaction so a crash
 * mid-loop (e.g. server killed, network blip) cannot leave some bets
 * scored and others stranded. Per-bet updates are batched with
 * `updateMany`: bets are first grouped by their computed
 * `pointsAwarded` value, then each group is split into chunks of
 * `SETTLE_CHUNK_SIZE` (100) bet IDs and one `updateMany` is issued
 * per chunk. This keeps the per-transaction round-trip count
 * manageable. The atomicity guarantee comes from the `$transaction`
 * wrapper, not from a single SQL statement. Any failure inside the
 * callback rolls back the whole settle (market stays un-settled,
 * match stays un-FINISHED, no per-bet pointsAwarded is written).
 *
 * The transaction is wrapped in a retry loop: transient infrastructure
 * errors (DB connection blips, timeouts, deadlocks) cause a backoff +
 * retry. Non-transient errors (validation, unique violation, business
 * logic) re-throw immediately. Input validation runs BEFORE the retry
 * loop so a 400 fails fast.
 *
 * The `options.sleep` parameter is for tests only — it lets the test
 * inject a no-op sleep so the retry tests don't wait real milliseconds.
 * In production, callers should not pass `options`.
 */
export async function settleMarket(
  input: SettleInput,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<SettleResult> {
  // Validate input BEFORE entering the retry loop. A 400 should fail
  // fast, not be retried.
  const trimmed = input.correctAnswer.trim();
  if (!trimmed) {
    throw new SettleError(400, "Correct answer is required");
  }

  const sleep = options.sleep ?? defaultSleep;
  const backoffs = SETTLE_RETRY_BACKOFFS_MS;
  let lastError: unknown = undefined;

  // Total of (1 + backoffs.length) attempts: the initial attempt, plus
  // one retry per backoff value. After the last backoff wait, the
  // last attempt runs. If it fails, we give up and re-throw.
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const market = await tx.betMarket.findUnique({
            where: { id: input.marketId },
            include: { match: true },
          });
          if (!market) {
            throw new SettleError(404, "MARKET_NOT_FOUND");
          }
          if (market.isSettled) {
            throw new SettleError(409, "ALREADY_SETTLED");
          }

          // 1. Update the market
          await tx.betMarket.update({
            where: { id: market.id },
            data: {
              correctAnswer: trimmed,
              isSettled: true,
            },
          });

          // 2. If anchored to a match, mark the match FINISHED
          if (market.match) {
            await tx.match.update({
              where: { id: market.match.id },
              data: { status: "FINISHED" },
            });
          }

          // 3. Pull all bets across every group in the competition
          const bets = await tx.userBet.findMany({
            where: { marketId: market.id },
            include: {
              group: { select: { id: true, name: true, scoringConfig: true } },
            },
          });

          const stage = market.match?.stage ?? "OUTRIGHT";
          const byGroupMap = new Map<string, SettleByGroup>();
          let scoredRows = 0;

          // Look up a scoring strategy. If the market type is not in the
          // registry (e.g. a legacy row whose market type was removed in a
          // later redesign), log a warning and skip the scoring loop. The
          // market is still marked settled + correctAnswer is preserved;
          // only the per-bet pointsAwarded is not updated.
          let strategy: ReturnType<typeof getStrategy> | null = null;
          try {
            strategy = getStrategy(market.type);
          } catch (e) {
            console.warn(
              `[settleMarket] No scoring strategy for market type ${market.type} ` +
                `(marketId=${market.id}); skipping scoring loop. ` +
                `Likely a legacy row predating a market redesign. ` +
                `Error: ${(e as Error).message}`,
            );
          }

          if (strategy) {
            // 1. Compute all scores in memory and accumulate byGroupMap.
            //    betsWithScore: Array<{ betId: string, groupId: string,
            //                          groupName: string, points: number }>
            const betsWithScore = bets.map((bet) => {
              const scoringConfig = bet.group.scoringConfig as unknown as ScoringConfig;
              const result = strategy.score({
                predictedValue: bet.predictedValue,
                correctAnswer: trimmed,
                marketType: market.type,
                matchStage: stage,
                scoringConfig,
                options: (market.options as string[] | null) ?? null,
              });
              // Per-bet floor: no individual bet ever costs the user more than
              // -1 point. The floor is applied per-bet here, before grouping.
              const clampedPoints = Math.max(-1, result.points);
              return {
                betId: bet.id,
                groupId: bet.groupId,
                groupName: bet.group.name,
                points: clampedPoints,
              };
            });

            // 2. Group bet IDs by their computed pointsAwarded value.
            //    Map<number, string[]> where the value is a list of bet IDs.
            const byPoints = new Map<number, string[]>();
            for (const { betId, points } of betsWithScore) {
              const list = byPoints.get(points);
              if (list) {
                list.push(betId);
              } else {
                byPoints.set(points, [betId]);
              }
            }

            // 3. Accumulate byGroupMap. Same as before — one entry per group
            //    with totalPoints and scoredRows summed across all points values.
            for (const { groupId, groupName, points } of betsWithScore) {
              const existing = byGroupMap.get(groupId);
              if (existing) {
                existing.scoredRows += 1;
                existing.totalPoints += points;
              } else {
                byGroupMap.set(groupId, {
                  groupId,
                  groupName,
                  scoredRows: 1,
                  totalPoints: points,
                });
              }
            }

            // 4. Issue chunked updateMany calls. For each distinct point
            //    value, split the bet IDs into chunks of SETTLE_CHUNK_SIZE
            //    and issue one updateMany per chunk. This reduces round-trips
            //    from N to ceil(N / SETTLE_CHUNK_SIZE) per point value.
            for (const [points, betIds] of byPoints) {
              for (let i = 0; i < betIds.length; i += SETTLE_CHUNK_SIZE) {
                const chunk = betIds.slice(i, i + SETTLE_CHUNK_SIZE);
                if (chunk.length === 0) continue; // defensive
                await tx.userBet.updateMany({
                  where: { id: { in: chunk } },
                  data: { pointsAwarded: points },
                });
                scoredRows += chunk.length;
              }
            }
          }

          return {
            marketId: market.id,
            marketType: market.type,
            correctAnswer: trimmed,
            scoredRows,
            byGroup: Array.from(byGroupMap.values()).sort(
              (a, b) => b.totalPoints - a.totalPoints,
            ),
          };
        },
        { timeout: 30_000, maxWait: 5_000 },
      );

      // Invalidate the leaderboard cache so all affected groups'
      // leaderboards are refetched on next request. The cache uses a
      // single global tag ("group-leaderboard"); a settle invalidates
      // every group's leaderboard entry at once. This is mild
      // over-invalidation, but settles are infrequent (only when an
      // admin marks a market settled) and the leaderboard data set is
      // small. Per-group tags would require a per-group cache function
      // (unstable_cache does not accept dynamic tag lists), which adds
      // complexity for marginal benefit.
      //
      // This MUST run after the transaction commits — cache
      // invalidation is a side effect that should only fire on a
      // durable state change. If the transaction rolls back, the
      // leaderboard stays valid.
      revalidateTag("group-leaderboard");

      return result;
    } catch (e) {
      lastError = e;
      // If we've exhausted our retries, or the error is not a
      // transient infrastructure issue, re-throw immediately.
      if (attempt >= backoffs.length || !isTransientPrismaError(e)) {
        throw e;
      }
      // Otherwise, log and back off.
      const backoffMs = backoffs[attempt];
      console.warn(
        `[settleMarket] transient error on attempt ${attempt + 1}; ` +
          `retrying in ${backoffMs}ms. Error: ${(e as Error).message}`,
      );
      await sleep(backoffMs);
    }
  }
  // Unreachable — the loop either returns or throws. But TypeScript
  // needs a return path; re-throw the last error to satisfy the
  // compiler.
  /* istanbul ignore next */
  throw lastError;
}

/**
 * LEGACY CLEANUP TOOL — DO NOT CALL FROM NORMAL FLOW.
 *
 * Recovers bets that were stranded by half-settled markets created
 * BEFORE the retry-on-failure fix was deployed (i.e. markets where
 * the original settleMarket() call was interrupted between the
 * betMarket.update and the per-bet userBet.update calls).
 *
 * For NEW settlements, the retry loop in settleMarket() handles
 * transient failures. You should not need this function for
 * post-fix markets. Use findStrandedBets() to scan for affected
 * markets and call this function once per affected market.
 *
 * Wire-up: call from a cron job that runs findStrandedBets() and
 * iterates the results with this function. Or call manually from
 * the admin UI.
 *
 * Recovery path for stranded bets on an already-settled market.
 *
 * A "stranded" bet is a UserBet row on a market that is
 * `isSettled = true` but whose own `pointsAwarded` is still NULL.
 * This can happen if the original `settleMarket()` was interrupted
 * mid-loop (e.g. server killed, $transaction timeout, deploy
 * rolling restart) AFTER the market was marked settled but BEFORE
 * the per-bet `userBet.update` calls completed. The market row and
 * the `correctAnswer` are durable, but the per-bet scoring was
 * lost. The user has seen the "market settled" UI but their score
 * never landed on the leaderboard.
 *
 * This function:
 *   1. Verifies the market exists and IS settled (409 if not — this
 *      is recovery, not first-time settlement; use `settleMarket`
 *      for that path).
 *   2. Re-computes the score for every stranded bet using the
 *      market's stored `correctAnswer` and each bet group's
 *      `scoringConfig`.
 *   3. Wraps the per-bet updates in a `$transaction` so a partial
 *      recovery is impossible.
 *   4. Invalidates `group-leaderboard` after the transaction
 *      commits, so the leaderboard refetches with the recovered
 *      points.
 *
 * The strategy lookup is wrapped in try/catch: a missing strategy
 * (e.g. a market type that was removed in a later redesign) is
 * logged and the function returns `{ recoveredRows: 0 }` without
 * touching any bets. The market stays settled (it was already
 * settled by the previous run); we just decline to score the
 * stranded bets for a market type we no longer know how to score.
 */
export async function recoverLegacyStrandedBets(
  marketId: string,
): Promise<{ recoveredRows: number }> {
  const market = await prisma.betMarket.findUnique({
    where: { id: marketId },
  });
  if (!market) {
    throw new SettleError(404, "MARKET_NOT_FOUND");
  }
  if (!market.isSettled) {
    throw new SettleError(
      409,
      "MARKET_NOT_SETTLED — use settleMarket() for first-time settlement",
    );
  }
  if (!market.correctAnswer) {
    // Defensive: a settled market with no correctAnswer is a data
    // anomaly. Nothing to score against.
    console.warn(
      `[recoverLegacyStrandedBets] settled market ${marketId} has no correctAnswer; nothing to recover.`,
    );
    return { recoveredRows: 0 };
  }

  // Look up the strategy up-front (outside the transaction) so a
  // missing strategy short-circuits without opening a transaction.
  // If the market was previously settled, the strategy must have
  // worked once — but a market type that was removed from the
  // registry after the original settle can leave the strategy
  // absent today. In that case, log a warning and return 0.
  let strategy: ReturnType<typeof getStrategy> | null = null;
  try {
    strategy = getStrategy(market.type);
  } catch (e) {
    console.warn(
      `[recoverLegacyStrandedBets] No scoring strategy for market type ${market.type} ` +
        `(marketId=${market.id}); skipping recovery. ` +
        `Likely the market type was removed from the registry after the original settle. ` +
        `Error: ${(e as Error).message}`,
    );
    return { recoveredRows: 0 };
  }

  const recoveredRows = await prisma.$transaction(
    async (tx) => {
      const stranded = await tx.userBet.findMany({
        where: { marketId: market.id, pointsAwarded: null },
        include: { group: { select: { id: true, name: true, scoringConfig: true } } },
      });

      const stage = market.matchId
        ? (
            await tx.match.findUnique({
              where: { id: market.matchId },
              select: { stage: true },
            })
          )?.stage ?? "OUTRIGHT"
        : "OUTRIGHT";

      let count = 0;
      for (const bet of stranded) {
        const scoringConfig = bet.group.scoringConfig as unknown as ScoringConfig;
        const result = strategy!.score({
          predictedValue: bet.predictedValue,
          correctAnswer: market.correctAnswer!,
          marketType: market.type,
          matchStage: stage,
          scoringConfig,
          options: (market.options as string[] | null) ?? null,
        });
        const clampedPoints = Math.max(-1, result.points);
        await tx.userBet.update({
          where: { id: bet.id },
          data: { pointsAwarded: clampedPoints },
        });
        count += 1;
      }
      return count;
    },
    { timeout: 30_000, maxWait: 5_000 },
  );

  if (recoveredRows > 0) {
    revalidateTag("group-leaderboard");
  }
  return { recoveredRows };
}

export type StrandedMarket = {
  marketId: string;
  marketType: string;
  strandedCount: number;
};

/**
 * Scan for markets that are marked settled but have bets with NULL
 * `pointsAwarded`. Used by the legacy cleanup cron to find candidates
 * for `recoverLegacyStrandedBets()`. Returns one entry per affected
 * market, sorted by stranded-bet count (descending) so the most
 * impactful markets are recovered first.
 */
export async function findStrandedBets(): Promise<StrandedMarket[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      marketId: string;
      marketType: string;
      strandedCount: bigint;
    }>
  >`
    SELECT m.id as "marketId", m.type as "marketType",
           COUNT(ub.id) as "strandedCount"
    FROM "BetMarket" m
    JOIN "UserBet" ub ON ub.marketId = m.id AND ub.pointsAwarded IS NULL
    WHERE m.isSettled = true
    GROUP BY m.id, m.type
    ORDER BY "strandedCount" DESC
  `;
  return rows.map((r) => ({
    marketId: r.marketId,
    marketType: r.marketType,
    strandedCount: Number(r.strandedCount),
  }));
}
