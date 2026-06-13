import { describe, it, expect, vi } from "vitest";

// Mock server-only so the test can import the module in a non-server
// context. The function has no server-only dependencies; the import
// is a guard against accidental client-side use.
vi.mock("server-only", () => ({}));

import { resolveConfig } from "./resolve-config";
import { DEFAULT_SCORING_CONFIG } from "@/lib/scoring/default-config";

describe("resolveConfig", () => {
  it("returns the default config when no match or group overrides are provided", () => {
    const result = resolveConfig({});
    // Spot check: the default's GROUP_STAGE.exactScorePoints should pass
    // through unchanged.
    expect(result.GROUP_STAGE.exactScorePoints).toBe(
      DEFAULT_SCORING_CONFIG.GROUP_STAGE.exactScorePoints,
    );
    // Same for every other stage — none of the defaults are touched.
    for (const stage of [
      "GROUP_STAGE",
      "ROUND_OF_16",
      "QUARTER_FINAL",
      "SEMI_FINAL",
      "FINAL",
      "THIRD_PLACE",
      "OUTRIGHT",
    ] as const) {
      expect(result[stage]).toEqual(DEFAULT_SCORING_CONFIG[stage]);
    }
  });

  it("uses the group config when no match override is present", () => {
    const groupConfig = {
      GROUP_STAGE: { exactScorePoints: 7 },
    };
    const result = resolveConfig({ groupScoringConfig: groupConfig });
    expect(result.GROUP_STAGE.exactScorePoints).toBe(7);
    // Other fields in GROUP_STAGE come from defaults.
    expect(result.GROUP_STAGE.drawExactScorePoints).toBe(
      DEFAULT_SCORING_CONFIG.GROUP_STAGE.drawExactScorePoints,
    );
  });

  it("uses the match override when present (no group config)", () => {
    const matchDetails = {
      scoringOverride: {
        SEMI_FINAL: { exactScorePoints: 9 },
      },
    };
    const result = resolveConfig({ matchDetails });
    expect(result.SEMI_FINAL.exactScorePoints).toBe(9);
    // GROUP_STAGE is unchanged from the default.
    expect(result.GROUP_STAGE).toEqual(DEFAULT_SCORING_CONFIG.GROUP_STAGE);
  });

  it("match override wins over group config for the same stage", () => {
    const matchDetails = {
      scoringOverride: {
        SEMI_FINAL: { exactScorePoints: 9 },
      },
    };
    const groupConfig = {
      SEMI_FINAL: { exactScorePoints: 7 },
    };
    const result = resolveConfig({ matchDetails, groupScoringConfig: groupConfig });
    expect(result.SEMI_FINAL.exactScorePoints).toBe(9);
  });

  it("group config wins over default for the same stage", () => {
    const groupConfig = {
      GROUP_STAGE: { exactScorePoints: 7 },
    };
    const result = resolveConfig({ groupScoringConfig: groupConfig });
    expect(result.GROUP_STAGE.exactScorePoints).toBe(7);
    expect(result.GROUP_STAGE.exactScorePoints).not.toBe(
      DEFAULT_SCORING_CONFIG.GROUP_STAGE.exactScorePoints,
    );
  });

  it("handles missing/invalid inputs gracefully", () => {
    const result = resolveConfig({
      matchDetails: null,
      groupScoringConfig: "not an object",
    });
    // Falls back to defaults entirely.
    expect(result.GROUP_STAGE).toEqual(DEFAULT_SCORING_CONFIG.GROUP_STAGE);
  });

  it("preserves other stage fields when only one is overridden", () => {
    const matchDetails = {
      scoringOverride: {
        SEMI_FINAL: { exactScorePoints: 9 },
      },
    };
    const result = resolveConfig({ matchDetails });
    // SEMI_FINAL.exactScorePoints is the override; other SEMI_FINAL
    // fields are unchanged from default.
    expect(result.SEMI_FINAL.exactScorePoints).toBe(9);
    expect(result.SEMI_FINAL.drawExactScorePoints).toBe(
      DEFAULT_SCORING_CONFIG.SEMI_FINAL.drawExactScorePoints,
    );
  });

  it("a partial group config (only some fields) is shallow-merged with defaults", () => {
    // Group has only one custom field; the rest of GROUP_STAGE comes
    // from the default.
    const groupConfig = {
      GROUP_STAGE: { exactScorePoints: 7 },
    };
    const result = resolveConfig({ groupScoringConfig: groupConfig });
    expect(result.GROUP_STAGE.exactScorePoints).toBe(7);
    expect(result.GROUP_STAGE.missPoints).toBe(
      DEFAULT_SCORING_CONFIG.GROUP_STAGE.missPoints,
    );
  });

  it("match override that targets a different stage does not affect the group stage", () => {
    const matchDetails = {
      scoringOverride: {
        FINAL: { exactScorePoints: 11 },
      },
    };
    const result = resolveConfig({ matchDetails });
    expect(result.FINAL.exactScorePoints).toBe(11);
    expect(result.GROUP_STAGE).toEqual(DEFAULT_SCORING_CONFIG.GROUP_STAGE);
    expect(result.SEMI_FINAL).toEqual(DEFAULT_SCORING_CONFIG.SEMI_FINAL);
  });

  it("all three: match > group > default (full precedence chain)", () => {
    const matchDetails = {
      scoringOverride: {
        GROUP_STAGE: { exactScorePoints: 99 },
      },
    };
    const groupConfig = {
      GROUP_STAGE: { exactScorePoints: 7 },
    };
    const result = resolveConfig({ matchDetails, groupScoringConfig: groupConfig });
    // Match wins.
    expect(result.GROUP_STAGE.exactScorePoints).toBe(99);
  });
});
