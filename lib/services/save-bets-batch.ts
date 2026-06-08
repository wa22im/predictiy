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

export type SaveBetsBatchInput = {
  groupId: string;
  matchId: string;
  /** Map of marketId → predictedValue. Each entry creates or updates a
   *  single UserBet. The required market (EXACT_SCORE) must be present.
   *  Optional markets (HALF_SCORING + IN_GAME_PENALTY) may be absent —
   *  meaning the user is not betting on them. The "correct winner"
   *  credit is folded into EXACT_SCORE's scoring — no separate winner
   *  pick is needed (or supported). */
  picks: Record<string, string>;
};

/**
 * Markets the user MUST pick on every match. The save form's Save
 * button is disabled if EXACT_SCORE is missing, and the server
 * rejects if the API call is missing it.
 */
const REQUIRED_MARKET_TYPES = new Set(["EXACT_SCORE"]);

/**
 * Idempotent batch save. Validates:
 *   - caller is a member of the group
 *   - match exists and is not in its 5-min lockdown window
 *   - each marketId in `picks` exists on the match and the value
 *     passes per-type validation
 *   - the required market (EXACT_SCORE) is present
 *
 * Upserts one UserBet row per pick. Preserves `availableFrom` on
 * update (= match.kickoffTime, set on first save).
 *
 * Delete behavior: if the user had a UserBet for an optional market
 * previously and that market is NOT in the new `picks` map, the
 * existing row is DELETED. This handles the "user removed a previous
 * pick" case cleanly — we don't want stale optional bets lingering.
 */
export async function saveBetsBatch(
  userId: string,
  input: SaveBetsBatchInput,
) {
  // 1. Membership
  const membership = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: { userId, groupId: input.groupId },
    },
  });
  if (!membership) {
    throw new SaveBetError(403, "NOT_MEMBER");
  }

  // 2. Match + markets on the match
  const match = await prisma.match.findUnique({
    where: { id: input.matchId },
    include: { markets: true },
  });
  if (!match) {
    throw new SaveBetError(404, "MATCH_NOT_FOUND");
  }
  if (isLocked({ kickoffTime: match.kickoffTime })) {
    throw new SaveBetError(403, "BETTING_LOCKED");
  }

  // 3. Validate that all required markets (by TYPE) are present in picks.
  //    We do this BEFORE the per-market value checks so missing-required
  //    errors are surfaced with a useful message.
  const marketsById = new Map(match.markets.map((m) => [m.id, m]));
  const marketsByType = new Map<string, typeof match.markets[number]>();
  for (const m of match.markets) marketsByType.set(m.type, m);

  for (const requiredType of REQUIRED_MARKET_TYPES) {
    const requiredMarket = marketsByType.get(requiredType);
    if (!requiredMarket) continue; // no such market on this match (shouldn't happen post-redesign)
    if (!Object.prototype.hasOwnProperty.call(input.picks, requiredMarket.id)) {
      const field =
        requiredType === "EXACT_SCORE" ? "exactScore" :
        requiredMarket.id;
      throw new SaveBetError(
        400,
        `Missing required pick: ${requiredType}`,
        field,
      );
    }
  }

  // 4. Per-pick value validation. Each marketId must be on this match,
  //    and the value must pass validatePrediction for that type.
  const normalized: Array<{
    marketId: string;
    marketType: string;
    value: string;
  }> = [];

  for (const [marketId, value] of Object.entries(input.picks)) {
    const market = marketsById.get(marketId);
    if (!market) {
      throw new SaveBetError(
        400,
        `Market ${marketId} is not on this match`,
        marketId,
      );
    }
    const normalizedValue = validatePrediction(
      market.type,
      market.options,
      value,
    );
    normalized.push({ marketId, marketType: market.type, value: normalizedValue });
  }

  // 5. Upsert each normalized pick. availableFrom is preserved on
  //    update (set to match.kickoffTime on first save).
  const availableFrom = match.kickoffTime;
  const results = [];
  for (const pick of normalized) {
    const bet = await prisma.userBet.upsert({
      where: {
        userId_groupId_marketId: {
          userId,
          groupId: input.groupId,
          marketId: pick.marketId,
        },
      },
      update: { predictedValue: pick.value },
      create: {
        userId,
        groupId: input.groupId,
        marketId: pick.marketId,
        predictedValue: pick.value,
        availableFrom,
      },
    });
    results.push(bet);
  }

  // 6. Delete behavior for previously-bet-on OPTIONAL markets that
  //    are NOT in the new picks map. Required markets can never be
  //    removed (see step 3 — they're guaranteed to be present).
  const presentMarketIds = new Set(normalized.map((n) => n.marketId));
  const allMatchMarketIds = match.markets.map((m) => m.id);
  const missingMarketIds = allMatchMarketIds.filter(
    (id) => !presentMarketIds.has(id),
  );
  if (missingMarketIds.length > 0) {
    // Only delete on OPTIONAL markets. Re-derive which of the missing
    // markets are optional: not in REQUIRED_MARKET_TYPES.
    const optionalMissing = missingMarketIds.filter((id) => {
      const m = marketsById.get(id);
      return m && !REQUIRED_MARKET_TYPES.has(m.type);
    });
    if (optionalMissing.length > 0) {
      await prisma.userBet.deleteMany({
        where: {
          userId,
          groupId: input.groupId,
          marketId: { in: optionalMissing },
        },
      });
    }
  }

  return results;
}

/**
 * Pure value-validation helper. Returns the normalized form (e.g.
 * uppercase for IN_GAME_PENALTY), or throws SaveBetError(400).
 */
export function validatePrediction(
  type: string,
  options: unknown,
  value: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SaveBetError(400, "Prediction cannot be empty", "predictedValue");
  }

  if (type === "EXACT_SCORE") {
    if (!/^\d+-\d+$/.test(trimmed)) {
      throw new SaveBetError(
        400,
        "Score must be in the form 'home-away' (e.g. 2-1)",
        "predictedValue",
      );
    }
  } else if (type === "HALF_SCORING") {
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
    const upper = trimmed.toUpperCase();
    if (!["HOME", "AWAY"].includes(upper)) {
      throw new SaveBetError(
        400,
        "In-game penalty pick must be HOME or AWAY",
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
