import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";

/**
 * In-game penalty — "Which team gets an in-game penalty?"
 *
 * Refers to a penalty awarded during regular or extra time (NOT the
 * post-match shootout). The api-football feed doesn't expose in-game
 * penalty data, so the market is auto-created on every match but
 * never auto-settled — the admin enters the correct answer manually
 * via the Settlement Hub.
 *
 * Predicted value: one of "HOME", "AWAY", "NONE" (case-insensitive on
 * input; stored uppercase by the save flow).
 * Correct answer:  the same shape.
 *
 * Scoring (raw, then clamped to per-bet floor):
 *   exact match → +3
 *   miss        → -2
 *   final       → Math.max(-1, raw)  — per-bet floor of -1
 * Range: -1 to +3.
 *
 * The -1 floor is the per-bet minimum points. It's applied inside the
 * strategy so the score result is already clamped; settle-market.ts
 * also clamps as a safety net.
 */
const IN_GAME_PENALTY_OPTIONS = new Set(["HOME", "AWAY", "NONE"]);

export const InGamePenaltyStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const p = input.predictedValue.trim().toUpperCase();
    const c = input.correctAnswer.trim().toUpperCase();
    if (!IN_GAME_PENALTY_OPTIONS.has(p) || !IN_GAME_PENALTY_OPTIONS.has(c)) {
      return { points: 0, breakdown: "Invalid in-game penalty pick" };
    }
    const rawPoints = p === c ? 3 : -2;
    const points = Math.max(-1, rawPoints);
    if (p === c) {
      return { points, breakdown: "Penalty team correct" };
    }
    return { points, breakdown: "Miss" };
  },
};
