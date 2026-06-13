import "server-only";
import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
  type StageScoring,
} from "@/lib/scoring/default-config";

/**
 * Merge scoring configs with precedence:
 *   Match.details > Competition.details.scoringOverridesByStage
 *   > Group.scoringConfig > Default
 *
 * The input is loosely typed (`unknown`) so the caller can pass the
 * raw JSONB values without a cast. Unexpected shapes (null, string,
 * array) are treated as "no override" rather than throwing.
 *
 * Per stage, the merge is shallow: defaults are the base, then group
 * fields, then competition-level overrides, then match-level
 * overrides. The output is a complete `ScoringConfig` — every key
 * is present, so the strategy code can index into it without
 * `??` fallbacks for missing stages.
 */
export function resolveConfig(opts: {
  matchDetails?: unknown;
  competitionDetails?: unknown;
  groupScoringConfig?: unknown;
}): ScoringConfig {
  const matchOverride = extractScoringOverride(opts.matchDetails);
  const competitionOverride = extractCompetitionOverride(opts.competitionDetails);
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
    const competitionStage = competitionOverride?.[stage] as StageScoring | undefined;
    const matchStage = matchOverride?.[stage] as StageScoring | undefined;
    result[stage] = {
      ...defaults,
      ...(groupStage ?? {}),
      ...(competitionStage ?? {}),
      ...(matchStage ?? {}),
    };
  }
  return result;
}

/**
 * Extract a `scoringOverride` field from `match.details`. Defensive
 * on the input.
 */
function extractScoringOverride(details: unknown): Partial<ScoringConfig> | null {
  if (!details || typeof details !== "object") return null;
  const obj = details as Record<string, unknown>;
  if (!obj.scoringOverride || typeof obj.scoringOverride !== "object") {
    return null;
  }
  return obj.scoringOverride as Partial<ScoringConfig>;
}

/**
 * Extract a `scoringOverridesByStage` field from `competition.details`.
 * This is the tournament-level scoring override that the admin sets
 * via the Edit modal. The shape is `{ <STAGE>: { <field>: <value> } }`.
 */
function extractCompetitionOverride(details: unknown): Partial<ScoringConfig> | null {
  if (!details || typeof details !== "object") return null;
  const obj = details as Record<string, unknown>;
  if (!obj.scoringOverridesByStage || typeof obj.scoringOverridesByStage !== "object") {
    return null;
  }
  return obj.scoringOverridesByStage as Partial<ScoringConfig>;
}

function isPartialScoringConfig(x: unknown): x is Partial<ScoringConfig> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
