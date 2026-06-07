import "server-only";
import { prisma } from "@/lib/prisma";
import { isLocked } from "@/lib/time";

export class SaveBetError extends Error {
  status: number;
  field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.name = "SaveBetError";
    this.field = field;
  }
}

export type SaveBetInput = {
  groupId: string;
  marketId: string;
  predictedValue: string;
};

/**
 * Idempotent save. Re-running with the same key updates the value (within
 * the lock window). Server-side lockdown check is the source of truth.
 */
export async function saveBet(userId: string, input: SaveBetInput) {
  // 1. Membership
  const membership = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: { userId, groupId: input.groupId },
    },
  });
  if (!membership) {
    throw new SaveBetError(403, "NOT_MEMBER");
  }

  // 2. Market + match
  const market = await prisma.betMarket.findUnique({
    where: { id: input.marketId },
    include: { match: true },
  });
  if (!market) {
    throw new SaveBetError(404, "MARKET_NOT_FOUND");
  }

  // 3. Lockdown (only applies to match-anchored markets; outright markets
  // are tied to the tournament winner, which doesn't have a single kickoff)
  if (market.match && isLocked({ kickoffTime: market.match.kickoffTime })) {
    throw new SaveBetError(403, "BETTING_LOCKED");
  }

  // 4. Validate the predicted value against the market type
  validatePrediction(market.type, market.options, input.predictedValue);

  // 5. availableFrom is set ONCE at first save (= match.kickoffTime) and
  //    preserved on update. Outright markets (no match) are revealed
  //    immediately. Query-side filter: WHERE availableFrom <= now().
  const availableFrom = market.match?.kickoffTime ?? new Date();

  const bet = await prisma.userBet.upsert({
    where: {
      userId_groupId_marketId: {
        userId,
        groupId: input.groupId,
        marketId: input.marketId,
      },
    },
    // On update: do NOT change availableFrom. The reveal time is fixed
    // by the bet's first save — the user can't "re-publish" later to
    // extend the visibility window.
    update: { predictedValue: input.predictedValue },
    create: {
      userId,
      groupId: input.groupId,
      marketId: input.marketId,
      predictedValue: input.predictedValue,
      availableFrom,
    },
  });

  return bet;
}

function validatePrediction(
  type: string,
  options: unknown,
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SaveBetError(400, "Prediction cannot be empty", "predictedValue");
  }

  if (type === "EXACT_SCORE") {
    // "X-Y" where X, Y are non-negative integers
    if (!/^\d+-\d+$/.test(trimmed)) {
      throw new SaveBetError(
        400,
        "Score must be in the form 'home-away' (e.g. 2-1)",
        "predictedValue",
      );
    }
  } else if (type === "PROPOSITION_CHOICE") {
    const opts = (options as string[] | null) ?? [];
    if (opts.length > 0 && !opts.includes(trimmed)) {
      throw new SaveBetError(
        400,
        "Pick one of the available options",
        "predictedValue",
      );
    }
  }
  // OUTRIGHT_TEXT: any non-empty string is allowed (free-form pick)
}
