import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";
import { stageConfigFor } from "./types";

/**
 * Spec §3.4 — outright text:
 *   Normalize both sides (lowercase + trim). Equal → staticPoints. Else 0.
 */
export const OutrightTextStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const stage = stageConfigFor(input.scoringConfig, input.matchStage);

    const p = input.predictedValue.toLowerCase().trim();
    const c = input.correctAnswer.toLowerCase().trim();

    if (!p || !c) {
      return { points: 0, breakdown: "Empty pick or result" };
    }
    if (p === c) {
      return { points: stage.staticPoints, breakdown: "Exact match" };
    }
    return { points: 0, breakdown: "Miss" };
  },
};
