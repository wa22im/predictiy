import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";
import { stageConfigFor } from "./types";

/**
 * Penalty shootout winner.
 *
 * Predicted value: one of "HOME", "AWAY", "NO_SHOOTOUT".
 * Correct answer: the same.
 *
 * Scoring: exact match → exactScorePoints. NO_SHOOTOUT only pays out
 * when there genuinely was no shootout (the match ended in regular or
 * extra time, not penalties).
 */
export const PenaltyShootoutStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const stage = stageConfigFor(input.scoringConfig, input.matchStage);

    const p = input.predictedValue.trim().toUpperCase();
    const c = input.correctAnswer.trim().toUpperCase();
    const valid = new Set(["HOME", "AWAY", "NO_SHOOTOUT"]);
    if (!valid.has(p) || !valid.has(c)) {
      return { points: 0, breakdown: "Invalid penalty shootout pick" };
    }
    if (p === c) {
      return { points: stage.exactScorePoints, breakdown: "Penalty winner correct" };
    }
    return { points: 0, breakdown: "Miss" };
  },
};
