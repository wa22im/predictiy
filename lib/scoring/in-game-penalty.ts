import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";

/**
 * In-game penalty — "Which team gets an in-game penalty?"
 *
 * Refers to a penalty awarded during regular or extra time (NOT the
 * post-match shootout). Distinguishing in-game penalties from
 * shootout data requires info the API doesn't surface, so this
 * market is created but never auto-settled — the admin enters the
 * correct answer manually via the Settlement Hub.
 *
 * Predicted value: one of "HOME", "AWAY", "NONE" (case-insensitive).
 * Correct answer: the same shape.
 *
 * Scoring:
 *   exact match → 3 points
 *   miss        → 0 points
 *
 * No negative points ever.
 */
const IN_GAME_PENALTY_OPTIONS = new Set(["HOME", "AWAY", "NONE"]);

export const InGamePenaltyStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const p = input.predictedValue.trim().toUpperCase();
    const c = input.correctAnswer.trim().toUpperCase();
    if (!IN_GAME_PENALTY_OPTIONS.has(p) || !IN_GAME_PENALTY_OPTIONS.has(c)) {
      return { points: 0, breakdown: "Invalid in-game penalty pick" };
    }
    if (p === c) {
      return { points: 3, breakdown: "Penalty team correct" };
    }
    return { points: 0, breakdown: "Miss" };
  },
};
