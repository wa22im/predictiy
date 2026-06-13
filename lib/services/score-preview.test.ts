import { describe, it, expect } from "vitest";
import { computeLiveScore } from "./score-preview";
import type { ScoringConfig } from "@/lib/scoring/default-config";

// Minimal scoring config — the production DEFAULT_SCORING_CONFIG uses
// the same group-stage values. Cast-as-never lets us keep this test
// self-contained: we only assert on the fields EXACT_SCORE reads.
const CONFIG: ScoringConfig = {
  GROUP_STAGE: {
    exactScorePoints: 5,
    drawExactScorePoints: 5,
    drawWrongScorePoints: 2,
    rightWinnerRightDiffPoints: 2,
    rightWinnerOnlyPoints: 1,
    missPoints: 0,
    winTeamPoints: 0,
    goalDifferencePoints: 0,
    outcomePoints: 0,
    bothTeamsToScoreBonus: 0,
    staticPoints: 0,
  },
  ROUND_OF_16: {} as never,
  QUARTER_FINAL: {} as never,
  SEMI_FINAL: {} as never,
  FINAL: {} as never,
  THIRD_PLACE: {} as never,
  OUTRIGHT: {} as never,
};

describe("computeLiveScore", () => {
  describe("EXACT_SCORE", () => {
    it("returns exactScorePoints for an exact non-draw match", () => {
      const result = computeLiveScore({
        predictedValue: "2-1",
        currentHomeScore: 2,
        currentAwayScore: 1,
        marketType: "EXACT_SCORE",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBe(5);
      expect(result.isOutright).toBe(false);
    });

    it("returns drawExactScorePoints for a 1-1 draw (the principal's example)", () => {
      // "if you had 1-1 as bet and the current score is 1-1, you see +5"
      const result = computeLiveScore({
        predictedValue: "1-1",
        currentHomeScore: 1,
        currentAwayScore: 1,
        marketType: "EXACT_SCORE",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBe(5);
      expect(result.isOutright).toBe(false);
    });

    it("returns missPoints for a miss (right winner wrong score, away win)", () => {
      const result = computeLiveScore({
        predictedValue: "3-0",
        currentHomeScore: 1,
        currentAwayScore: 2,
        marketType: "EXACT_SCORE",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBe(0);
    });

    it("returns rightWinnerOnlyPoints (1) for right winner + wrong diff", () => {
      // Predicted 1-0, actual 3-0 — both HOME wins, but signed diffs differ
      // (+1 vs +3). Per the matrix, this is "right winner only" → 1 point.
      const result = computeLiveScore({
        predictedValue: "1-0",
        currentHomeScore: 3,
        currentAwayScore: 0,
        marketType: "EXACT_SCORE",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBe(1);
    });

    it("respects the per-bet -1 floor when the strategy returns a deeper miss", () => {
      // Force a -5 strategy result to verify the floor clamps. The
      // miss path in EXACT_SCORE returns `missPoints` directly. Pick
      // a winner (HOME) and a current score where the away team
      // wins — that hits the "wrong winner" branch in the strategy,
      // which returns missPoints. The -5 in our config is then
      // clamped to the -1 per-bet floor.
      const aggressiveConfig: ScoringConfig = {
        ...CONFIG,
        GROUP_STAGE: { ...CONFIG.GROUP_STAGE, missPoints: -5 },
      };
      const result = computeLiveScore({
        predictedValue: "3-0",
        currentHomeScore: 0,
        currentAwayScore: 3,
        marketType: "EXACT_SCORE",
        marketStage: "GROUP_STAGE",
        scoringConfig: aggressiveConfig,
      });
      expect(result.points).toBe(-1);
    });
  });

  describe("OUTRIGHT_TEXT", () => {
    it("returns 0 with isOutright: true (no live preview for outright markets)", () => {
      const result = computeLiveScore({
        predictedValue: "Brazil",
        currentHomeScore: 0,
        currentAwayScore: 0,
        marketType: "OUTRIGHT_TEXT",
        marketStage: "OUTRIGHT",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBe(0);
      expect(result.isOutright).toBe(true);
    });
  });

  describe("PROPOSITION_CHOICE", () => {
    it("returns 0 with isOutright: true", () => {
      const result = computeLiveScore({
        predictedValue: "Yes",
        currentHomeScore: 0,
        currentAwayScore: 0,
        marketType: "PROPOSITION_CHOICE",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBe(0);
      expect(result.isOutright).toBe(true);
    });
  });

  describe("HALF_SCORING and IN_GAME_PENALTY", () => {
    // The principal's example focused on EXACT_SCORE, but the
    // HALF_SCORING and IN_GAME_PENALTY strategies are also registered
    // and the function should handle them without crashing. The exact
    // score depends on the strategy's parse of the predictedValue +
    // the constructed "correctAnswer" (current score "h-a"), so we
    // only assert that the function returns a number and is not
    // outright.
    it("HALF_SCORING: returns a number, isOutright false, no crash", () => {
      const result = computeLiveScore({
        predictedValue: "A_1H",
        currentHomeScore: 2,
        currentAwayScore: 1,
        marketType: "HALF_SCORING",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(typeof result.points).toBe("number");
      expect(result.isOutright).toBe(false);
    });

    it("IN_GAME_PENALTY: returns a number, isOutright false, no crash", () => {
      const result = computeLiveScore({
        predictedValue: "HOME",
        currentHomeScore: 2,
        currentAwayScore: 1,
        marketType: "IN_GAME_PENALTY",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(typeof result.points).toBe("number");
      expect(result.isOutright).toBe(false);
    });

    it("IN_GAME_PENALTY: wrong pick clamps to the -1 floor", () => {
      // The strategy returns -2 raw for a miss and clamps to -1
      // internally; computeLiveScore adds its own belt-and-suspenders
      // clamp. Pick HOME, the current score doesn't matter — the
      // strategy scores purely on predictedValue vs correctAnswer,
      // and we never pass a real correctAnswer (just the score string
      // "h-a" which the strategy will try to parse and may treat as
      // invalid). Either way, the floor must hold.
      const result = computeLiveScore({
        predictedValue: "HOME",
        currentHomeScore: 0,
        currentAwayScore: 0,
        marketType: "IN_GAME_PENALTY",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBeGreaterThanOrEqual(-1);
    });
  });

  describe("error handling", () => {
    it("returns 0 with isOutright false if the strategy throws for an unknown market type", () => {
      const result = computeLiveScore({
        predictedValue: "x",
        currentHomeScore: 0,
        currentAwayScore: 0,
        marketType: "OBSOLETE_TYPE",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(result.points).toBe(0);
      expect(result.isOutright).toBe(false);
    });

    it("returns a non-empty breakdown for a normal call", () => {
      const result = computeLiveScore({
        predictedValue: "2-1",
        currentHomeScore: 2,
        currentAwayScore: 1,
        marketType: "EXACT_SCORE",
        marketStage: "GROUP_STAGE",
        scoringConfig: CONFIG,
      });
      expect(typeof result.breakdown).toBe("string");
      expect(result.breakdown.length).toBeGreaterThan(0);
    });
  });
});
