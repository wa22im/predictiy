import "server-only";
import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
  type StageScoring,
} from "@/lib/scoring/default-config";

/**
 * Merge scoring configs with precedence: match > group > default.
 *
 * The input is loosely typed (`unknown`) so the caller can pass the
 * raw `match.details` JSON and the `group.scoringConfig` JSON
 * without a cast — this keeps the row schema decoupled from the
 * scoring internals. Both fields are validated defensively: an
 * unexpected shape (null, string, array) is treated as "no
 * override" rather than throwing.
 *
 * Per stage, the merge is shallow: defaults are the base, group
 * fields override, match fields win. The output is a complete
 * `ScoringConfig` — every key from `ScoringConfig` is present, so
 * the strategy code can index into it without `??` fallbacks for
 * missing stages.
 */
export function resolveConfig(opts: {
  matchDetails?: unknown;
  groupScoringConfig?: unknown;
}): ScoringConfig {
  const matchOverride = extractScoringOverride(opts.matchDetails);
  const groupConfig = isPartialScoringConfig(opts.groupScoringConfig)
    ? opts.groupScoringConfig
    : null;

  const stages: Array<keyof ScoringConfig> = [
    "GROUP_STAGE",
    "ROUND_OF_16",
    "QUARTER_FINAL",
    "SEMI_FINAL",
    "FINAL",
    "THIRD_PLACE",
    "OUTRIGHT",
  ];

  const result = {} as ScoringConfig;
  for (const stage of stages) {
    const defaults = DEFAULT_SCORING_CONFIG[stage];
    const groupStage = groupConfig?.[stage] as StageScoring | undefined;
    const matchStage = matchOverride?.[stage] as StageScoring | undefined;
    result[stage] = { ...defaults, ...(groupStage ?? {}), ...(matchStage ?? {}) };
  }
  return result;
}

/**
 * Extract a `scoringOverride` field from `match.details`. Defensive
 * on the input: null, undefined, non-objects, or objects without a
 * `scoringOverride` field all return null (= "no per-match override").
 */
function extractScoringOverride(details: unknown): Partial<ScoringConfig> | null {
  if (!details || typeof details !== "object") return null;
  const obj = details as Record<string, unknown>;
  if (!obj.scoringOverride || typeof obj.scoringOverride !== "object") return null;
  return obj.scoringOverride as Partial<ScoringConfig>;
}

function isPartialScoringConfig(x: unknown): x is Partial<ScoringConfig> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
