import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";
import { stageConfigFor } from "./types";

/**
 * Exact-score — "Predict the final score."
 *
 * Predicted and correct values are both "X-Y" where X and Y are
 * non-negative integers (e.g. "2-1"). The winner is *derived* from the
 * score (HOME if home>away, DRAW if equal, AWAY if away>home).
 *
 * Scoring matrix (Phase 10.10b — stage-dependent, injectable):
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
 * All values come from `StageScoring` config (see
 * `lib/scoring/default-config.ts`). The strategy has no hardcoded
 * point values — changing a stage's config changes the scoring for
 * every group whose `scoringConfig` is set to `DEFAULT_SCORING_CONFIG`.
 *
 * Legacy groups (with old `scoringConfig` JSON that lacks the new
 * fields) get a sensible per-field fallback. The fallback values match
 * the group-stage values, which matches Phase 10.10 behavior.
 *
 * The signed goal diff is (home - away) for the actual, and
 * (predictedHome - predictedAway) for the user. The winner MUST be
 * the team the user predicted to win for the diff bonus to apply.
 * Absolute diff doesn't count: a 3-1 prediction and a 1-3 actual
 * both have absolute diff 2 but different signed diffs (+2 vs -2).
 */
const FALLBACK = {
  exactScorePoints: 5,
  drawExactScorePoints: 5,
  drawWrongScorePoints: 2,
  rightWinnerRightDiffPoints: 2,
  rightWinnerOnlyPoints: 1,
  missPoints: 0,
} as const;

export const ExactScoreStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const stage = stageConfigFor(input.scoringConfig, input.matchStage);
    const pts = {
      exactScorePoints: stage.exactScorePoints ?? FALLBACK.exactScorePoints,
      drawExactScorePoints: stage.drawExactScorePoints ?? FALLBACK.drawExactScorePoints,
      drawWrongScorePoints: stage.drawWrongScorePoints ?? FALLBACK.drawWrongScorePoints,
      rightWinnerRightDiffPoints:
        stage.rightWinnerRightDiffPoints ?? FALLBACK.rightWinnerRightDiffPoints,
      rightWinnerOnlyPoints: stage.rightWinnerOnlyPoints ?? FALLBACK.rightWinnerOnlyPoints,
      missPoints: stage.missPoints ?? FALLBACK.missPoints,
    };

    const pParts = input.predictedValue.split("-").map((s) => Number(s.trim()));
    const cParts = input.correctAnswer.split("-").map((s) => Number(s.trim()));

    if (pParts.length !== 2 || cParts.length !== 2) {
      return { points: pts.missPoints, breakdown: "Invalid score" };
    }
    const [pH, pA] = pParts;
    const [cH, cA] = cParts;
    if ([pH, pA, cH, cA].some((n) => !Number.isFinite(n))) {
      return { points: pts.missPoints, breakdown: "Invalid score" };
    }

    const pWinner = winner(pH, pA);
    const cWinner = winner(cH, cA);
    const pDiff = pH - pA;
    const cDiff = cH - cA;

    if (pH === cH && pA === cA) {
      const exactPts = cWinner === "DRAW" ? pts.drawExactScorePoints : pts.exactScorePoints;
      return { points: exactPts, breakdown: "Exact score" };
    }

    if (cWinner === "DRAW") {
      if (pWinner === "DRAW") {
        return { points: pts.drawWrongScorePoints, breakdown: "Draw (any draw score)" };
      }
      return { points: pts.missPoints, breakdown: "Miss" };
    }

    if (pWinner === "DRAW") {
      return { points: pts.missPoints, breakdown: "Miss" };
    }

    if (pWinner === cWinner) {
      if (pDiff === cDiff) {
        return { points: pts.rightWinnerRightDiffPoints, breakdown: "Right winner + right goal diff" };
      }
      return { points: pts.rightWinnerOnlyPoints, breakdown: "Right winner only" };
    }

    return { points: pts.missPoints, breakdown: "Miss" };
  },
};

function winner(home: number, away: number): "HOME" | "DRAW" | "AWAY" {
  if (home > away) return "HOME";
  if (home < away) return "AWAY";
  return "DRAW";
}
