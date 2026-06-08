import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";
import { stageConfigFor } from "./types";

/**
 * Half-time / Full-time.
 *
 * Predicted value format: "H/H", "H/D", … (one of the 9 combinations
 * defined in ingest-league.ts HT_FT_OPTIONS).
 * Correct answer is the same shape.
 *
 * Scoring:
 *   - both halves correct:        exactScorePoints
 *   - exactly one half correct:  half of outcomePoints
 *   - both wrong:                 0
 *
 * This is intentionally a touch softer than EXACT_SCORE — there are
 * 9 options, so a random guess is more likely to land on something
 * close. The 1/2 outcomePoints partial credit reflects that.
 */
export const HtFtStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const stage = stageConfigFor(input.scoringConfig, input.matchStage);

    const p = input.predictedValue.trim().toUpperCase();
    const c = input.correctAnswer.trim().toUpperCase();
    if (p.length !== 3 || c.length !== 3 || p[1] !== "/" || c[1] !== "/") {
      return { points: 0, breakdown: "Invalid HT/FT format" };
    }
    const [pH, , pF] = p;
    const [cH, , cF] = c;

    const halfRight = (pH === cH ? 1 : 0) + (pF === cF ? 1 : 0);

    if (halfRight === 2) {
      return { points: stage.exactScorePoints, breakdown: "Exact HT/FT" };
    }
    if (halfRight === 1) {
      return { points: Math.floor(stage.outcomePoints / 2), breakdown: "Got one half right" };
    }
    return { points: 0, breakdown: "Miss" };
  },
};
