import { ExactScoreStrategy } from "./exact-score";
import { OutrightTextStrategy } from "./outright-text";
import { PropositionChoiceStrategy } from "./proposition-choice";
import type { ScoringStrategy } from "./types";

const registry: Record<string, ScoringStrategy> = {
  EXACT_SCORE: ExactScoreStrategy,
  OUTRIGHT_TEXT: OutrightTextStrategy,
  PROPOSITION_CHOICE: PropositionChoiceStrategy,
};

export function getStrategy(marketType: string): ScoringStrategy {
  const strategy = registry[marketType];
  if (!strategy) {
    throw new Error(`No scoring strategy for market type: ${marketType}`);
  }
  return strategy;
}
