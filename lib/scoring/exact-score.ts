import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";
import { stageConfigFor } from "./types";

/**
 * Exact-score — "Predict the final score."
 *
 * Predicted and correct values are both "X-Y" where X and Y are
 * non-negative integers (e.g. "2-1"). The winner is *derived* from
 * the score (HOME if home>away, DRAW if equal, AWAY if away>home) —
 * the user's predicted score "3-1" implies they think HOME wins,
 * so the winner partial credit can be folded in here without a
 * separate market.
 *
 * Scoring (per-stage, from `StageScoring.{exactScorePoints, winTeamPoints}`):
 *   - exact match (predicted home === correct home AND predicted away
 *     === correct away):     exactScorePoints + winTeamPoints
 *   - winner match only (the derived winner matches across predicted
 *     and correct):          winTeamPoints
 *   - miss:                   0
 *
 * Per-stage weights:
 *   - group stage:    +3 + 1 = 4 on exact, +1 on winner-only, 0 on miss
 *   - knockout stage: +5 + 2 = 7 on exact, +2 on winner-only, 0 on miss
 *
 * Draw handling: 1-1 vs 2-2 are both draws (DRAW === DRAW → winner
 * correct). 1-1 vs 1-0 → DRAW vs HOME → wrong. 0-0 vs 1-1 → DRAW vs
 * DRAW → correct.
 *
 * No negative points. The per-bet floor (-1) is applied centrally in
 * `lib/services/settle-market.ts`; since this strategy only returns 0
 * or a positive value, the clamp is a no-op for EXACT_SCORE.
 */
export const ExactScoreStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const stage = stageConfigFor(input.scoringConfig, input.matchStage);

    const pParts = input.predictedValue.split("-").map((s) => Number(s.trim()));
    const cParts = input.correctAnswer.split("-").map((s) => Number(s.trim()));

    if (pParts.length !== 2 || cParts.length !== 2) {
      return { points: 0, breakdown: "Invalid score" };
    }
    const [pH, pA] = pParts;
    const [cH, cA] = cParts;
    if ([pH, pA, cH, cA].some((n) => !Number.isFinite(n))) {
      return { points: 0, breakdown: "Invalid score" };
    }

    if (pH === cH && pA === cA) {
      return {
        points: stage.exactScorePoints + stage.winTeamPoints,
        breakdown: "Exact score",
      };
    }
    if (winner(pH, pA) === winner(cH, cA)) {
      return { points: stage.winTeamPoints, breakdown: "Correct winner" };
    }
    return { points: 0, breakdown: "Miss" };
  },
};

function winner(home: number, away: number): "HOME" | "DRAW" | "AWAY" {
  if (home > away) return "HOME";
  if (home < away) return "AWAY";
  return "DRAW";
}
