/**
 * Admin-only match update service.
 *
 * The Settlement Hub calls this to record a match's actual data
 * (status, score, half-time goals, in-game penalties). If the update
 * *transitions* a match to FINISHED (i.e. the previous status was
 * not FINISHED), the three default markets are auto-settled with
 * the correct answer derived from the same payload. A re-settle
 * (e.g. an admin correcting a previously-settled score) does NOT
 * re-run scoring — markets stay settled and a warning is logged.
 *
 * Penalty semantics:
 *   The `homePenalties` / `awayPenalties` columns now hold the count
 *   of in-game penalties awarded during regular/extra time, NOT the
 *   shootout result. The shootout data is no longer imported from
 *   any external feed — see 7.12 in steps.md for the rationale.
 *
 *   The IN_GAME_PENALTY market's correctAnswer is derived as:
 *     HOME  — homePenalties > 0  && awayPenalties === 0
 *     AWAY  — awayPenalties > 0  && homePenalties === 0
 *     NONE  — homePenalties === 0 && awayPenalties === 0
 *
 *   If both teams received an in-game penalty (e.g. one each), we
 *   throw a friendly error explaining the limitation — the admin
 *   should fall back to manual settlement via the Hub.
 *
 * Half-time score → HALF_SCORING:
 *   `A_1H` if homeHtGoals > 0
 *   `A_2H` if (homeScore - homeHtGoals) > 0
 *   `B_1H` if awayHtGoals > 0
 *   `B_2H` if (awayScore - awayHtGoals) > 0
 *   Empty string (auto-settle skipped) if HT data is missing.
 *
 * Idempotency:
 *   - The Match row is updated in place (no upsert — we require an
 *     existing matchId).
 *   - Markets are only auto-settled if they were not previously
 *     settled. Re-running on a FINISHED match is a no-op for the
 *     markets; the fields on the match itself are still applied.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { type SettleResult } from "@/lib/services/settle-market";
import { autoSettleMatch } from "@/lib/services/auto-settle";

export type UpdateMatchInput = {
  status?: "SCHEDULED" | "GOING" | "FINISHED";
  homeScore?: number | null;
  awayScore?: number | null;
  homeHtGoals?: number | null;
  awayHtGoals?: number | null;
  homePenalties?: number | null;
  awayPenalties?: number | null;
};

export type UpdateMatchResult = {
  matchId: string;
  match: {
    id: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    homeHtGoals: number | null;
    awayHtGoals: number | null;
    homePenalties: number | null;
    awayPenalties: number | null;
  };
  /** True iff the call transitioned the match into FINISHED. */
  transitionedToFinished: boolean;
  /** Auto-settle results, one per market we attempted. Only present
   *  if `transitionedToFinished` is true. */
  settlements: SettleResult[];
  /** Non-fatal warnings (e.g. couldn't auto-settle a market). */
  warnings: string[];
};

export class UpdateMatchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "UpdateMatchError";
  }
}

export async function adminUpdateMatch(
  matchId: string,
  input: UpdateMatchInput,
): Promise<UpdateMatchResult> {
  const existing = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeHtGoals: true,
      awayHtGoals: true,
      homePenalties: true,
      awayPenalties: true,
    },
  });
  if (!existing) {
    throw new UpdateMatchError(404, "MATCH_NOT_FOUND");
  }

  // Build the partial update object — only include fields the caller
  // actually provided. We distinguish "caller wants null" from
  // "caller didn't say" by checking for `undefined` explicitly.
  const data: Record<string, unknown> = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.homeScore !== undefined) data.homeScore = input.homeScore;
  if (input.awayScore !== undefined) data.awayScore = input.awayScore;
  if (input.homeHtGoals !== undefined) data.homeHtGoals = input.homeHtGoals;
  if (input.awayHtGoals !== undefined) data.awayHtGoals = input.awayHtGoals;
  if (input.homePenalties !== undefined) data.homePenalties = input.homePenalties;
  if (input.awayPenalties !== undefined) data.awayPenalties = input.awayPenalties;

  // Reject an empty update — there's nothing to do.
  if (Object.keys(data).length === 0) {
    throw new UpdateMatchError(400, "NO_FIELDS_TO_UPDATE");
  }

  const updated = await prisma.match.update({
    where: { id: matchId },
    data,
    select: {
      id: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeHtGoals: true,
      awayHtGoals: true,
      homePenalties: true,
      awayPenalties: true,
    },
  });

  const prevStatus = existing.status;
  const newStatus = updated.status;
  const transitioned =
    prevStatus !== "FINISHED" && newStatus === "FINISHED";

  const result: UpdateMatchResult = {
    matchId: updated.id,
    match: updated,
    transitionedToFinished: transitioned,
    settlements: [],
    warnings: [],
  };

  if (transitioned) {
    const outcome = await autoSettleMatch(updated);
    result.settlements.push(...outcome.settlements);
    result.warnings.push(...outcome.warnings);
  }

  return result;
}
