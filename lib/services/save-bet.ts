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

  // 4. Validate the predicted value against the market type; may
  //    return a normalized form (e.g. uppercase for IN_GAME_PENALTY).
  const normalized = validatePrediction(
    market.type,
    market.options,
    input.predictedValue,
  );

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
    update: { predictedValue: normalized },
    create: {
      userId,
      groupId: input.groupId,
      marketId: input.marketId,
      predictedValue: normalized,
      availableFrom,
    },
  });

  return bet;
}

function validatePrediction(
  type: string,
  options: unknown,
  value: string,
): string {
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
  } else if (type === "HALF_SCORING") {
    // Comma-separated set of exactly 2 distinct codes from
    // {A_1H, A_2H, B_1H, B_2H}. e.g. "A_1H,B_2H".
    const parts = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length !== 2) {
      throw new SaveBetError(
        400,
        "Half-scoring pick must be exactly 2 codes (e.g. A_1H,B_2H)",
        "predictedValue",
      );
    }
    const valid = new Set(["A_1H", "A_2H", "B_1H", "B_2H"]);
    const seen = new Set<string>();
    for (const p of parts) {
      if (!valid.has(p)) {
        throw new SaveBetError(
          400,
          "Half-scoring pick must be from A_1H, A_2H, B_1H, B_2H",
          "predictedValue",
        );
      }
      if (seen.has(p)) {
        throw new SaveBetError(
          400,
          "Half-scoring pick must not contain duplicates",
          "predictedValue",
        );
      }
      seen.add(p);
    }
  } else if (type === "IN_GAME_PENALTY") {
    // Case-insensitive on input; normalized to uppercase for storage.
    const upper = trimmed.toUpperCase();
    if (!["HOME", "AWAY", "NONE"].includes(upper)) {
      throw new SaveBetError(
        400,
        "In-game penalty pick must be HOME, AWAY, or NONE",
        "predictedValue",
      );
    }
    return upper;
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
  return trimmed;
}
