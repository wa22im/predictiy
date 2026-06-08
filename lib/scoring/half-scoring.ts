import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";

/**
 * Half-scoring — "Which teams score in which half?"
 *
 * Predicted and correct values are both comma-separated sets of codes
 * from {A_1H, A_2H, B_1H, B_2H} (A = home, B = away, 1H/2H = which half).
 * Order is irrelevant; both are parsed as Sets.
 *
 * Scoring (per-pick, then clamped):
 *   for each of the user's up-to-2 picks:
 *     +1 if the code is in the correct set
 *     -1 if not
 *   sum them, then clamp to `Math.max(-1, sum)`.
 *   Range: -1 (both wrong) to +2 (both correct).
 *
 * The -1 floor is the per-bet minimum points (no single bet ever costs
 * more than -1), which is applied here at the strategy level. The
 * settlement service also clamps to -1 as a belt-and-suspenders, but
 * the strategy itself never returns less than -1.
 *
 * Invalid input (wrong count, duplicate values, invalid codes, etc.)
 * yields `points: 0` with a clear breakdown. Never throws.
 */
const HALF_SCORING_CODES = ["A_1H", "A_2H", "B_1H", "B_2H"] as const;
const HALF_SCORING_SET: ReadonlySet<string> = new Set(HALF_SCORING_CODES);

function parseHalfScoringSet(
  raw: string,
): { ok: true; set: Set<string> } | { ok: false; reason: string } {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p)) {
      return { ok: false, reason: `Duplicate value: ${p}` };
    }
    if (!HALF_SCORING_SET.has(p)) {
      return { ok: false, reason: `Invalid code: ${p}` };
    }
    seen.add(p);
  }
  return { ok: true, set: seen };
}

export const HalfScoringStrategy: ScoringStrategy = {
  score(input: StrategyInput): StrategyResult {
    const pParse = parseHalfScoringSet(input.predictedValue);
    if (!pParse.ok) {
      return { points: 0, breakdown: `Invalid pick: ${pParse.reason}` };
    }
    const cParse = parseHalfScoringSet(input.correctAnswer);
    if (!cParse.ok) {
      return { points: 0, breakdown: `Invalid correct answer: ${cParse.reason}` };
    }

    let sum = 0;
    for (const code of pParse.set) {
      sum += cParse.set.has(code) ? 1 : -1;
    }
    const points = Math.max(-1, sum);

    if (points === 2) return { points, breakdown: "Full match (2/2)" };
    if (points === 1) return { points, breakdown: "Partial (1/2)" };
    if (points === 0) return { points, breakdown: "Mixed (0/2)" };
    return { points, breakdown: "Both wrong" };
  },
};
