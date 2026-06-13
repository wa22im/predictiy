import { getStrategy } from "@/lib/scoring";
import type { ScoringConfig } from "@/lib/scoring/default-config";

export type LiveScoreInput = {
  predictedValue: string;
  currentHomeScore: number;
  currentAwayScore: number;
  marketType: string;
  marketStage: string;
  scoringConfig: ScoringConfig;
  marketOptions?: string[] | null;
};

export type LiveScoreResult = {
  points: number;
  breakdown: string;
  isOutright: boolean;
};

const PER_BET_FLOOR = -1;

const OUTRIGHT_MARKET_TYPES = new Set(["OUTRIGHT_TEXT", "PROPOSITION_CHOICE"]);

/**
 * Pure function: compute the live-preview points for a bet given the
 * current score.
 *
 * "What would I get if the game ended right now?" — the current score
 * is treated as the hypothetical final score, the existing scoring
 * strategy for the market type is invoked, and the per-bet floor (-1)
 * is applied.
 *
 * Outright markets (tournament winner, free-form proposition) have no
 * live score by definition. The function short-circuits and returns
 * `points: 0, isOutright: true` for these so the UI can render a
 * "(no live preview)" badge instead of a misleading number.
 *
 * NOTE: This file is deliberately NOT `server-only`. The live preview
 * runs in both the server (server component path) and the client
 * (polling effect in components/matches/MatchCard.tsx). The function
 * has no DB / network dependencies — it depends only on the pure
 * scoring strategies in `lib/scoring/*` and the config in
 * `lib/scoring/default-config.ts`. Keep it that way.
 */
export function computeLiveScore(input: LiveScoreInput): LiveScoreResult {
  if (OUTRIGHT_MARKET_TYPES.has(input.marketType)) {
    return {
      points: 0,
      breakdown: "Outright market — no live preview",
      isOutright: true,
    };
  }

  try {
    const strategy = getStrategy(input.marketType);
    const result = strategy.score({
      predictedValue: input.predictedValue,
      correctAnswer: `${input.currentHomeScore}-${input.currentAwayScore}`,
      marketType: input.marketType,
      matchStage: input.marketStage,
      scoringConfig: input.scoringConfig,
      options: input.marketOptions ?? null,
    });
    const clampedPoints = Math.max(PER_BET_FLOOR, result.points);
    return {
      points: clampedPoints,
      breakdown: result.breakdown,
      isOutright: false,
    };
  } catch {
    return {
      points: 0,
      breakdown: "No strategy available",
      isOutright: false,
    };
  }
}
