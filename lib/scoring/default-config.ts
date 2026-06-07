/**
 * Default scoring config for new groups.
 * Per-stage weights for the Strategy Factory:
 *  - exactScorePoints: awarded for an exact score match
 *  - outcomePoints:    awarded for matching the W/D/L outcome only
 *  - bothTeamsToScoreBonus: stacked on top of exact OR outcome
 *  - staticPoints:     flat points for OUTRIGHT_TEXT markets
 *
 * Late-stage matches count for more to amplify risk in knockouts.
 */

export type StageScoring = {
  exactScorePoints: number;
  outcomePoints: number;
  bothTeamsToScoreBonus: number;
  staticPoints: number;
};

export type ScoringConfig = {
  GROUP_STAGE: StageScoring;
  ROUND_OF_16: StageScoring;
  QUARTER_FINAL: StageScoring;
  SEMI_FINAL: StageScoring;
  FINAL: StageScoring;
  THIRD_PLACE: StageScoring;
  OUTRIGHT: StageScoring;
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  GROUP_STAGE: {
    exactScorePoints: 5,
    outcomePoints: 2,
    bothTeamsToScoreBonus: 1,
    staticPoints: 0,
  },
  ROUND_OF_16: {
    exactScorePoints: 8,
    outcomePoints: 3,
    bothTeamsToScoreBonus: 1,
    staticPoints: 0,
  },
  QUARTER_FINAL: {
    exactScorePoints: 12,
    outcomePoints: 4,
    bothTeamsToScoreBonus: 1,
    staticPoints: 0,
  },
  SEMI_FINAL: {
    exactScorePoints: 18,
    outcomePoints: 6,
    bothTeamsToScoreBonus: 1,
    staticPoints: 0,
  },
  THIRD_PLACE: {
    exactScorePoints: 18,
    outcomePoints: 6,
    bothTeamsToScoreBonus: 1,
    staticPoints: 0,
  },
  FINAL: {
    exactScorePoints: 25,
    outcomePoints: 8,
    bothTeamsToScoreBonus: 1,
    staticPoints: 0,
  },
  OUTRIGHT: {
    exactScorePoints: 0,
    outcomePoints: 0,
    bothTeamsToScoreBonus: 0,
    staticPoints: 15,
  },
};

export function getStageConfig(stage: string): StageScoring {
  const config =
    DEFAULT_SCORING_CONFIG[stage as keyof ScoringConfig] ??
    DEFAULT_SCORING_CONFIG.GROUP_STAGE;
  return config;
}
