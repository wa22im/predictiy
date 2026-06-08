/**
 * Shared auto-settle helper.
 *
 * Extracted from `lib/services/admin-update-match.ts` so the new
 * football-data sync pipeline (`lib/services/sync-football-data-competition.ts`)
 * can reuse the same transition-aware settlement logic that the
 * admin-driven match update flow uses.
 *
 * Semantics (unchanged from the original location):
 *   - The caller is responsible for detecting a status *transition* into
 *     FINISHED (previous != "FINISHED" && new === "FINISHED") and for
 *     only invoking this helper when such a transition has occurred.
 *   - Already-settled markets are left alone — a warning is recorded.
 *   - A match with missing score / HT data is auto-settled for whatever
 *     we can derive, and warnings are returned for the rest.
 *   - The function is best-effort: it never throws. Settle failures are
 *     recorded as warnings so the caller can surface them in the result.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { settleMarket, SettleError, type SettleResult } from "@/lib/services/settle-market";

export type AutoSettleMatchInput = {
  id: string;
  homeScore: number | null;
  awayScore: number | null;
  homeHtGoals: number | null;
  awayHtGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
};

export type AutoSettleOutcome = {
  settlements: SettleResult[];
  /** Non-fatal warnings (e.g. couldn't auto-settle a market). */
  warnings: string[];
};

/**
 * Auto-settle the default markets for a match whose status has just
 * transitioned to FINISHED. Currently only EXACT_SCORE is auto-settled
 * — HALF_SCORING and IN_GAME_PENALTY are disabled in the current
 * scoring system (Phase 10.9) and emit warnings instead. Returns the
 * per-market settle results + any warnings.
 *
 * The function is idempotent: markets that are already settled are
 * skipped (a warning is recorded explaining why we left the previous
 * correctAnswer in place).
 */
export async function autoSettleMatch(
  match: AutoSettleMatchInput,
): Promise<AutoSettleOutcome> {
  const outcome: AutoSettleOutcome = { settlements: [], warnings: [] };
  await autoSettleAll(match.id, match, outcome);
  return outcome;
}

/**
 * Internal: same logic as `autoSettleMatch` but accumulates into an
 * existing `AutoSettleOutcome` (used when the caller already has an
 * outcome object to extend).
 */
async function autoSettleAll(
  matchId: string,
  match: AutoSettleMatchInput,
  result: AutoSettleOutcome,
): Promise<void> {
  // 1. EXACT_SCORE
  if (match.homeScore !== null && match.awayScore !== null) {
    await trySettle(
      matchId,
      "EXACT_SCORE",
      "Predict the final score",
      `${match.homeScore}-${match.awayScore}`,
      result,
    );
  } else {
    result.warnings.push(
      "EXACT_SCORE not auto-settled: homeScore/awayScore missing on the match row.",
    );
  }

  // 2. HALF_SCORING — disabled in the current scoring system (Phase 10.9).
  //    Bets on this market (if any) are left unsettled. Re-enable by
  //    uncommenting the derivation block + trySettle call.
  result.warnings.push(
    "HALF_SCORING not auto-settled: market disabled in current scoring system.",
  );

  // 3. IN_GAME_PENALTY — disabled in the current scoring system (Phase 10.9).
  //    Bets on this market (if any) are left unsettled. Re-enable by
  //    uncommenting the derivation block + trySettle call.
  result.warnings.push(
    "IN_GAME_PENALTY not auto-settled: market disabled in current scoring system.",
  );
}

/**
 * Derive the IN_GAME_PENALTY correctAnswer from the per-team counts.
 * Returns null when the auto-settler can't make a clear call — the
 * caller should surface this as a warning.
 *
 * The column values are nullable: null === 0 (the admin hasn't
 * entered anything yet), so nulls are treated as zero.
 *
 * Phase 7.16 (2026-06-08): "NONE" was removed from the market's
 * option list. The return type dropped it. Now the function returns
 * `null` for two distinct cases:
 *   1. both teams have 0 penalties — the market is void, no clear
 *      answer exists, and "NONE" is no longer a valid option to
 *      settle to. Caller logs a "void" warning.
 *   2. both teams have > 0 penalties — would need a "BOTH" option
 *      that the market doesn't expose. Caller logs a "settle
 *      manually" warning (existing behaviour).
 */
function derivePenaltyAnswer(
  homePenalties: number | null | undefined,
  awayPenalties: number | null | undefined,
): "HOME" | "AWAY" | null {
  const home = homePenalties ?? 0;
  const away = awayPenalties ?? 0;
  if (home === 0 && away === 0) return null;
  if (home > 0 && away > 0) return null;
  if (home > 0) return "HOME";
  return "AWAY";
}

async function trySettle(
  matchId: string,
  marketType: string,
  marketTitle: string,
  correctAnswer: string,
  result: AutoSettleOutcome,
): Promise<void> {
  try {
    const market = await prisma.betMarket.findUnique({
      where: {
        matchId_type_title: { matchId, type: marketType, title: marketTitle },
      },
      select: { id: true, isSettled: true },
    });
    if (!market) {
      result.warnings.push(
        `${marketType} not auto-settled: market row missing on the match.`,
      );
      return;
    }
    if (market.isSettled) {
      // Don't re-settle. A previously-settled market is the result
      // of an earlier admin action; the user has already scored
      // their bets. Leave it alone.
      result.warnings.push(
        `${marketType} was already settled — leaving the previous correctAnswer in place.`,
      );
      return;
    }
    const settled = await settleMarket({
      marketId: market.id,
      correctAnswer,
    });
    result.settlements.push(settled);
  } catch (e) {
    if (e instanceof SettleError) {
      result.warnings.push(`settle ${marketType}: ${e.message}`);
    } else {
      result.warnings.push(`settle ${marketType}: ${(e as Error).message}`);
    }
  }
}
