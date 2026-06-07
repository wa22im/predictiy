import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";

/**
 * Placeholder for proposition-choice markets. Returns 0 with a
 * breakdown message until a real strategy is implemented.
 */
export const PropositionChoiceStrategy: ScoringStrategy = {
  score(_input: StrategyInput): StrategyResult {
    return { points: 0, breakdown: "PROPOSITION_CHOICE not yet implemented" };
  },
};
