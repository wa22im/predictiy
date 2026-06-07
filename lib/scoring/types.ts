import type { ScoringConfig, StageScoring } from "./default-config";

export type StrategyInput = {
  predictedValue: string;
  correctAnswer: string;
  marketType: string;
  matchStage: string;
  scoringConfig: ScoringConfig;
  options?: string[] | null;
};

export type StrategyResult = {
  points: number;
  breakdown: string;
};

export interface ScoringStrategy {
  score(input: StrategyInput): StrategyResult;
}

export function stageConfigFor(
  config: ScoringConfig,
  stage: string,
): StageScoring {
  return (
    config[stage as keyof ScoringConfig] ??
    config.GROUP_STAGE
  );
}
