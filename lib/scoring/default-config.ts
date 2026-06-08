/**
 * Default scoring config for new groups.
 *
 * Stage-dependent scoring (Phase 10.10b) — the EXACT_SCORE strategy
 * reads its 6 fields from `StageScoring` (one entry per match stage).
 * Older fields are kept for back-compat and any future strategies
 * that need them.
 *
 * EXACT_SCORE scoring matrix (read from `StageScoring`):
 *
 *   | Actual   | User bet                | Group | Knockout |
 *   | -------- | ----------------------- | ----- | -------- |
 *   | DRAW     | exact draw              | 5     | 6        |
 *   | DRAW     | wrong draw score        | 2     | 3        |
 *   | DRAW     | bet on a winner         | 0     | 0        |
 *   | NON-DRAW | exact                   | 5     | 7        |
 *   | NON-DRAW | right winner + right    | 2     | 3        |
 *   |          | signed goal diff        |       |          |
 *   | NON-DRAW | right winner + wrong    | 1     | 2        |
 *   |          | signed goal diff        |       |          |
 *   | NON-DRAW | wrong winner            | 0     | 0        |
 *
 * Fields consumed by the EXACT_SCORE strategy:
 *  - exactScorePoints:           non-draw exact score
 *  - drawExactScorePoints:       exact draw score
 *  - drawWrongScorePoints:       draw actual + any draw bet
 *  - rightWinnerRightDiffPoints: non-draw + right winner + right signed diff
 *  - rightWinnerOnlyPoints:      non-draw + right winner + wrong signed diff
 *  - missPoints:                 everything else (wrong winner, bet draw
 *                                on non-draw, etc.)
 *
 * The strategy falls back to the group-stage values per field when a
 * config entry is missing — this keeps legacy groups (with old
 * `scoringConfig` JSON) behaving like group-stage scoring.
 *
 * Legacy fields (no longer consumed by any active strategy, but
 * kept for back-compat and any future re-introduction):
 *  - winTeamPoints:             @deprecated — superseded by
 *                               rightWinnerRightDiffPoints +
 *                               rightWinnerOnlyPoints
 *  - goalDifferencePoints:      @deprecated — superseded by
 *                               rightWinnerRightDiffPoints
 *  - outcomePoints:             @deprecated — no longer used
 *  - bothTeamsToScoreBonus:     @deprecated — no longer used
 *
 * Other:
 *  - staticPoints:              flat points for OUTRIGHT_TEXT markets
 *
 * The per-bet floor (-1) is still applied centrally in
 * `lib/services/settle-market.ts`. The HALF_SCORING and IN_GAME_PENALTY
 * strategies remain registered (see `lib/scoring/index.ts`) so that
 * bets settled under the previous scoring system continue to resolve
 * correctly, but they are no longer auto-settled (see
 * `lib/services/auto-settle.ts`) and their markets are hidden in the
 * user UI. To re-enable them, also restore the auto-settle blocks and
 * the UI rows.
 */

export type StageScoring = {
  /** Non-draw exact score (e.g. predicted 2-1, actual 2-1, no draw). */
  exactScorePoints: number;
  /** Exact draw score (e.g. predicted 1-1, actual 1-1). */
  drawExactScorePoints: number;
  /** Draw actual + any draw bet (wrong draw score). */
  drawWrongScorePoints: number;
  /** Non-draw + right winner + right signed goal diff. */
  rightWinnerRightDiffPoints: number;
  /** Non-draw + right winner + wrong signed goal diff. */
  rightWinnerOnlyPoints: number;
  /** Miss (wrong winner, or bet draw on a non-draw, etc.). */
  missPoints: number;
  /** @deprecated — superseded by rightWinnerRightDiffPoints / rightWinnerOnlyPoints. */
  winTeamPoints: number;
  /** @deprecated — superseded by rightWinnerRightDiffPoints. */
  goalDifferencePoints: number;
  /** @deprecated — no longer used by any strategy. */
  outcomePoints: number;
  /** @deprecated — no longer used by any strategy. */
  bothTeamsToScoreBonus: number;
  /** Flat points for OUTRIGHT_TEXT markets. */
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

/**
 * Group-stage EXACT_SCORE scoring (Phase 10.10b):
 * exact=5, draw-exact=5, draw-wrong=2, right-winner-right-diff=2,
 * right-winner-only=1, miss=0.
 */
const GROUP_STAGE_SCORING: StageScoring = {
  exactScorePoints: 5,
  drawExactScorePoints: 5,
  drawWrongScorePoints: 2,
  rightWinnerRightDiffPoints: 2,
  rightWinnerOnlyPoints: 1,
  missPoints: 0,
  winTeamPoints: 1,
  goalDifferencePoints: 1,
  outcomePoints: 0,
  bothTeamsToScoreBonus: 0,
  staticPoints: 0,
};

/**
 * Knockout EXACT_SCORE scoring (R16, QF, SF, 3rd, F — Phase 10.10b):
 * exact=7, draw-exact=6, draw-wrong=3, right-winner-right-diff=3,
 * right-winner-only=2, miss=0. Knockout points are higher because
 * the games are rarer and more decisive.
 */
const KNOCKOUT_SCORING: StageScoring = {
  exactScorePoints: 7,
  drawExactScorePoints: 6,
  drawWrongScorePoints: 3,
  rightWinnerRightDiffPoints: 3,
  rightWinnerOnlyPoints: 2,
  missPoints: 0,
  winTeamPoints: 1,
  goalDifferencePoints: 1,
  outcomePoints: 0,
  bothTeamsToScoreBonus: 0,
  staticPoints: 0,
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  GROUP_STAGE: { ...GROUP_STAGE_SCORING },
  ROUND_OF_16: { ...KNOCKOUT_SCORING },
  QUARTER_FINAL: { ...KNOCKOUT_SCORING },
  SEMI_FINAL: { ...KNOCKOUT_SCORING },
  THIRD_PLACE: { ...KNOCKOUT_SCORING },
  FINAL: { ...KNOCKOUT_SCORING },
  OUTRIGHT: {
    exactScorePoints: 0,
    drawExactScorePoints: 0,
    drawWrongScorePoints: 0,
    rightWinnerRightDiffPoints: 0,
    rightWinnerOnlyPoints: 0,
    missPoints: 0,
    winTeamPoints: 0,
    goalDifferencePoints: 0,
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
