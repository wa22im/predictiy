import { describe, it, expect, vi } from "vitest";

// Mock server-only so the service module is importable in unit tests.
vi.mock("server-only", () => ({}));

import { mapStage } from "./stage-mapper";

/**
 * Table-driven coverage of `mapStage`. The function must normalise
 * football-data.org's free-form stage strings onto the 7
 * `ScoringConfig` keys (plus `OUTRIGHT` for outright market types).
 *
 * Why a strict normaliser matters: the previous implementation
 * matched on `s.includes("KNOCKOUT")` and similar, which catches
 * SEMI_FINALS, QUARTER_FINALS, and LAST_16 with the same string
 * and collapses them to a single bucket. The new strategy returns
 * the *exact* ScoringConfig key for each API value.
 */
describe("mapStage", () => {
  describe("direct exact matches", () => {
    it("FINAL → FINAL", () => expect(mapStage("FINAL")).toBe("FINAL"));
    it("THIRD_PLACE → THIRD_PLACE", () => expect(mapStage("THIRD_PLACE")).toBe("THIRD_PLACE"));
    it("SEMI_FINALS → SEMI_FINAL", () => expect(mapStage("SEMI_FINALS")).toBe("SEMI_FINAL"));
    it("QUARTER_FINALS → QUARTER_FINAL", () => expect(mapStage("QUARTER_FINALS")).toBe("QUARTER_FINAL"));
    it("LAST_16 → ROUND_OF_16", () => expect(mapStage("LAST_16")).toBe("ROUND_OF_16"));
    it("GROUP_STAGE → GROUP_STAGE", () => expect(mapStage("GROUP_STAGE")).toBe("GROUP_STAGE"));
  });

  describe("new CL 2024-25 format", () => {
    it("LEAGUE_STAGE → GROUP_STAGE", () => expect(mapStage("LEAGUE_STAGE")).toBe("GROUP_STAGE"));
    it("PLAYOFFS → ROUND_OF_16", () => expect(mapStage("PLAYOFFS")).toBe("ROUND_OF_16"));
    it("LAST_32 → ROUND_OF_16", () => expect(mapStage("LAST_32")).toBe("ROUND_OF_16"));
    it("LAST_64 → ROUND_OF_16", () => expect(mapStage("LAST_64")).toBe("ROUND_OF_16"));
  });

  describe("other tournament formats", () => {
    it("REGULAR_SEASON → GROUP_STAGE", () => expect(mapStage("REGULAR_SEASON")).toBe("GROUP_STAGE"));
    it("CHAMPIONSHIP → GROUP_STAGE", () => expect(mapStage("CHAMPIONSHIP")).toBe("GROUP_STAGE"));
    it("CLAUSURA → GROUP_STAGE", () => expect(mapStage("CLAUSURA")).toBe("GROUP_STAGE"));
    it("APERTURA → GROUP_STAGE", () => expect(mapStage("APERTURA")).toBe("GROUP_STAGE"));
    it("QUALIFICATION → GROUP_STAGE", () => expect(mapStage("QUALIFICATION")).toBe("GROUP_STAGE"));
    it("QUALIFICATION_ROUND_1 → GROUP_STAGE", () => expect(mapStage("QUALIFICATION_ROUND_1")).toBe("GROUP_STAGE"));
    it("QUALIFICATION_ROUND_2 → GROUP_STAGE", () => expect(mapStage("QUALIFICATION_ROUND_2")).toBe("GROUP_STAGE"));
    it("PLAYOFF_ROUND_1 → QUARTER_FINAL", () => expect(mapStage("PLAYOFF_ROUND_1")).toBe("QUARTER_FINAL"));
    it("PLAYOFF_ROUND_2 → QUARTER_FINAL", () => expect(mapStage("PLAYOFF_ROUND_2")).toBe("QUARTER_FINAL"));
    it("RELEGATION → GROUP_STAGE", () => expect(mapStage("RELEGATION")).toBe("GROUP_STAGE"));
    it("RELEGATION_ROUND → GROUP_STAGE", () => expect(mapStage("RELEGATION_ROUND")).toBe("GROUP_STAGE"));
    it("PRELIMINARY_ROUND → GROUP_STAGE", () => expect(mapStage("PRELIMINARY_ROUND")).toBe("GROUP_STAGE"));
    it("ROUND_1 → GROUP_STAGE", () => expect(mapStage("ROUND_1")).toBe("GROUP_STAGE"));
    it("ROUND_2 → GROUP_STAGE", () => expect(mapStage("ROUND_2")).toBe("GROUP_STAGE"));
    it("ROUND_3 → GROUP_STAGE", () => expect(mapStage("ROUND_3")).toBe("GROUP_STAGE"));
    it("ROUND_4 → GROUP_STAGE", () => expect(mapStage("ROUND_4")).toBe("GROUP_STAGE"));
  });

  describe("case insensitivity", () => {
    it("lowercase final → FINAL", () => expect(mapStage("final")).toBe("FINAL"));
    it("mixed case Semi_Finals → SEMI_FINAL", () => expect(mapStage("Semi_Finals")).toBe("SEMI_FINAL"));
  });

  describe("null and unknown", () => {
    it("null → GROUP_STAGE", () => expect(mapStage(null)).toBe("GROUP_STAGE"));
    it("undefined → GROUP_STAGE", () => expect(mapStage(undefined)).toBe("GROUP_STAGE"));
    it("empty string → GROUP_STAGE", () => expect(mapStage("")).toBe("GROUP_STAGE"));
    it("garbage → GROUP_STAGE", () => expect(mapStage("not a real stage")).toBe("GROUP_STAGE"));
  });

  describe("outright market types", () => {
    it("OUTRIGHT_TEXT + any stage → OUTRIGHT", () => expect(mapStage("FINAL", "OUTRIGHT_TEXT")).toBe("OUTRIGHT"));
    it("PROPOSITION_CHOICE + any stage → OUTRIGHT", () => expect(mapStage("GROUP_STAGE", "PROPOSITION_CHOICE")).toBe("OUTRIGHT"));
    it("EXACT_SCORE + any stage → stage (not outright)", () => expect(mapStage("FINAL", "EXACT_SCORE")).toBe("FINAL"));
  });
});
