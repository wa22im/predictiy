import type { ScoringStrategy, StrategyInput, StrategyResult } from "./types";

/**
 * Half-scoring — "Which teams score in which half?"
 *
 * Predicted and correct values are both comma-separated sets of codes
 * from {A_1H, A_2H, B_1H, B_2H} (A = home, B = away, 1H/2H = which half).
 * Order is irrelevant; both are parsed as Sets.
 *
 * Scoring:
 *   points = |predicted ∩ correct|, capped at the predicted set size
 *            (and the spec caps the predicted set at 2).
 *   Range: 0 to 2.
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

    const predictedSize = Math.min(pParse.set.size, 2);
    let overlap = 0;
    for (const code of pParse.set) {
      if (cParse.set.has(code)) overlap += 1;
    }
    const points = Math.max(0, Math.min(overlap, predictedSize));

    if (points === 0) {
      return { points: 0, breakdown: "No overlap" };
    }
    if (points === predictedSize) {
      return { points, breakdown: `Full match (${points}/${predictedSize})` };
    }
    return { points, breakdown: `Partial match (${points}/${predictedSize})` };
  },
};
