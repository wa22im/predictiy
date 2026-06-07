import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";
import { stageConfigFor } from "./types";

/**
 * Spec §3.4 — exact-score rules:
 *  1. exact match → exactScorePoints
 *  2. outcome match (W/D/L) → outcomePoints
 *  3. Both Teams To Score (BTTS) bonus is stacked on top of either (1) or (2)
 *     when the real result had BTTS AND the prediction also had BTTS.
 */
export const ExactScoreStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const stage = stageConfigFor(input.scoringConfig, input.matchStage);

    const pParts = input.predictedValue.split("-").map((s) => Number(s.trim()));
    const cParts = input.correctAnswer.split("-").map((s) => Number(s.trim()));

    if (pParts.length !== 2 || cParts.length !== 2) {
      return { points: 0, breakdown: "Invalid score format" };
    }
    const [pH, pA] = pParts;
    const [cH, cA] = cParts;
    if ([pH, pA, cH, cA].some((n) => !Number.isFinite(n))) {
      return { points: 0, breakdown: "Non-numeric score" };
    }

    const bttsActual = (cH ?? 0) > 0 && (cA ?? 0) > 0;
    const bttsPredicted = (pH ?? 0) > 0 && (pA ?? 0) > 0;
    const btts = bttsActual && bttsPredicted;
    const bonus = btts ? stage.bothTeamsToScoreBonus : 0;

    if (pH === cH && pA === cA) {
      return {
        points: stage.exactScorePoints + bonus,
        breakdown: btts ? `Exact + BTTS bonus` : "Exact match",
      };
    }

    const pOutcome = pH! > pA! ? "W" : pH! < pA! ? "L" : "D";
    const cOutcome = cH! > cA! ? "W" : cH! < cA! ? "L" : "D";
    if (pOutcome === cOutcome) {
      return {
        points: stage.outcomePoints + bonus,
        breakdown: btts ? `Outcome (${pOutcome}) + BTTS bonus` : `Outcome (${pOutcome})`,
      };
    }

    return { points: 0, breakdown: "Miss" };
  },
};
