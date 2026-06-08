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
 * Predicted value: one of "HOME", "AWAY" (case-insensitive on input;
 * stored uppercase by the save flow). Phase 7.16 (2026-06-08) removed
 * "NONE" from new markets, but this strategy still ACCEPTS "NONE" for
 * backward-compat scoring of legacy rows (markets persisted with the
 * 3-option shape). Saving a new "NONE" pick is rejected by
 * `validatePrediction`; only historical rows reach this code path.
 * Correct answer:  the same shape (HOME / AWAY; "NONE" is still
 * accepted because a legacy correctAnswer could in theory carry it).
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
const IN_GAME_PENALTY_OPTIONS = new Set(["HOME", "AWAY"]);

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
