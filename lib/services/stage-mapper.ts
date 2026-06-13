/**
 * Stage normaliser for football-data.org → `ScoringConfig` keys.
 *
 * football-data.org's `/matches` endpoint returns a free-form `stage`
 * string per match. The values vary by competition and by season —
 * Champions League 2024-25 introduced `LEAGUE_STAGE` and `PLAYOFFS`,
 * and historic competitions use `ROUND_1` / `QUALIFICATION` /
 * `CLAUSURA` / etc. The rest of the app reasons about matches in
 * terms of the 7 `ScoringConfig` keys (see
 * `lib/scoring/default-config.ts`), so every match in the system
 * has to be normalised to one of those keys when ingested.
 *
 * This module is the single source of truth for that mapping. It is
 * consumed by:
 *   - `applyFootballDataMatches` (the per-match upsert path)
 *
 * Keeping the function in a small standalone file (rather than buried
 * inside the apply service) lets the unit tests hit it directly
 * without needing the prisma / football-data mock stack.
 */

import "server-only";

/**
 * Stages that match our `ScoringConfig` keys in
 * `lib/scoring/default-config.ts`. The MATCH.stage column is stored
 * as one of these 7 values.
 *
 * Note: `OUTRIGHT` is for tournament-winner markets (no specific
 * match stage). It is returned only when the caller passes an
 * outright `marketType`; unknown match stages fall back to
 * `GROUP_STAGE`.
 */
export type MatchStage =
  | "GROUP_STAGE"
  | "ROUND_OF_16"
  | "QUARTER_FINAL"
  | "SEMI_FINAL"
  | "FINAL"
  | "THIRD_PLACE"
  | "OUTRIGHT";

/**
 * Normalise football-data.org's `stage` string to one of our 7
 * `MatchStage` keys. Handles the new 2024-25 Champions League
 * format (LEAGUE_STAGE, PLAYOFFS) and falls back to GROUP_STAGE for
 * any unrecognized value.
 */
export function mapStage(
  stage: string | null | undefined,
  marketType?: string,
): MatchStage {
  // Outright markets have no match stage.
  if (marketType === "OUTRIGHT_TEXT" || marketType === "PROPOSITION_CHOICE") {
    return "OUTRIGHT";
  }

  if (!stage) return "GROUP_STAGE";
  const s = stage.toUpperCase();

  // Direct exact matches
  if (s === "FINAL") return "FINAL";
  if (s === "THIRD_PLACE") return "THIRD_PLACE";
  if (s === "SEMI_FINALS") return "SEMI_FINAL";
  if (s === "QUARTER_FINALS") return "QUARTER_FINAL";
  if (s === "LAST_16") return "ROUND_OF_16";
  if (s === "GROUP_STAGE") return "GROUP_STAGE";

  // Looser matches for new format + similar stages
  if (s === "LEAGUE_STAGE") return "GROUP_STAGE"; // new CL 2024-25 format
  if (s === "REGULAR_SEASON") return "GROUP_STAGE";
  if (s === "PLAYOFFS") return "ROUND_OF_16"; // new CL early knockout
  if (s === "LAST_32" || s === "LAST_64") return "ROUND_OF_16";
  if (s === "QUALIFICATION" || s.startsWith("QUALIFICATION_ROUND"))
    return "GROUP_STAGE";
  if (s === "PLAYOFF_ROUND_1" || s === "PLAYOFF_ROUND_2")
    return "QUARTER_FINAL";
  if (s === "RELEGATION" || s === "RELEGATION_ROUND") return "GROUP_STAGE";
  if (s === "CHAMPIONSHIP") return "GROUP_STAGE";
  if (s === "CLAUSURA" || s === "APERTURA") return "GROUP_STAGE";
  if (s === "PRELIMINARY_ROUND") return "GROUP_STAGE";
  if (s.startsWith("ROUND_")) return "GROUP_STAGE";

  // Fallback for any unrecognized value
  return "GROUP_STAGE";
}
