export type ScoringExampleStage = "GROUP" | "KNOCKOUT";

export type ScoringExampleWinner = "HOME" | "AWAY" | "DRAW";

export type ScoringExampleBreakdown = {
  market: string;
  pick: string;
  points: number;
  note: string;
};

/**
 * Stage-dependent scoring matrix (Phase 10.10b — values come from
 * `StageScoring` in `lib/scoring/default-config.ts`):
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
 * The signed goal diff is (home - away); absolute diff doesn't count.
 * The per-bet floor (-1) is applied centrally in
 * `lib/services/settle-market.ts` — since EXACT_SCORE only ever
 * returns 0 or a positive value, the floor is a no-op for this
 * strategy. HALF_SCORING and IN_GAME_PENALTY are no longer scored
 * (markets are hidden in the UI and skipped by the auto-settler).
 */
export type ScoringExample = {
  title: string;
  match: string;
  stage: ScoringExampleStage;
  userBet: { exactScore: string };
  result: { finalScore: string; winner: ScoringExampleWinner };
  breakdown: ScoringExampleBreakdown[];
  total: number;
  explanation: string;
};

export const SCORING_EXAMPLES: ScoringExample[] = [
  {
    title: "Tunisia vs Canada — exact draw (group)",
    match: "Tunisia vs Canada",
    stage: "GROUP",
    userBet: { exactScore: "1-1" },
    result: { finalScore: "1-1", winner: "DRAW" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "1-1",
        points: 5,
        note: "Exact draw score (group stage) → +5",
      },
    ],
    total: 5,
    explanation:
      "Predicted the exact draw score (1-1 = 1-1). Group-stage draws pay +5; the same draw in a knockout would pay +6.",
  },
  {
    title: "Mexico vs South Africa — wrong draw score (group)",
    match: "Mexico vs South Africa",
    stage: "GROUP",
    userBet: { exactScore: "0-0" },
    result: { finalScore: "1-1", winner: "DRAW" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "0-0",
        points: 2,
        note: "DRAW actual, user bet DRAW (wrong score, group) → +2",
      },
    ],
    total: 2,
    explanation:
      "You called the draw but missed the exact score. Any wrong draw prediction on a draw game scores +2 in the group stage (or +3 in a knockout).",
  },
  {
    title: "Brazil vs Cameroon — exact score (group)",
    match: "Brazil vs Cameroon",
    stage: "GROUP",
    userBet: { exactScore: "2-1" },
    result: { finalScore: "2-1", winner: "HOME" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-1",
        points: 5,
        note: "Exact non-draw score (group) → +5",
      },
    ],
    total: 5,
    explanation:
      "An exact non-draw score is worth +5 in the group stage — same as an exact draw. In a knockout the same exact score pays +7.",
  },
  {
    title: "Germany vs Portugal — right winner + right goal diff (group)",
    match: "Germany vs Portugal",
    stage: "GROUP",
    userBet: { exactScore: "2-0" },
    result: { finalScore: "3-1", winner: "HOME" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-0",
        points: 2,
        note: "Right winner (HOME) + right signed diff (+2, group) → +2",
      },
    ],
    total: 2,
    explanation:
      "Both teams you picked to win did — and the signed goal difference matches (2-0 = +2, 3-1 = +2). +2 in the group stage; +3 in a knockout.",
  },
  {
    title: "France vs Spain — right winner only (group)",
    match: "France vs Spain",
    stage: "GROUP",
    userBet: { exactScore: "1-0" },
    result: { finalScore: "3-0", winner: "HOME" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "1-0",
        points: 1,
        note: "Right winner (HOME) but wrong signed diff (+1 vs +3, group) → +1",
      },
    ],
    total: 1,
    explanation:
      "Nailed the winner (HOME) but the signed goal difference is off (+1 vs +3). +1 in the group stage; +2 in a knockout.",
  },
  {
    title: "USA vs England — wrong winner (group)",
    match: "USA vs England",
    stage: "GROUP",
    userBet: { exactScore: "3-1" },
    result: { finalScore: "1-3", winner: "AWAY" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "3-1",
        points: 0,
        note: "Wrong winner (predicted HOME, got AWAY) → 0",
      },
    ],
    total: 0,
    explanation:
      "Absolute diff is 2 in both (3-1 and 1-3) but the signed diff differs (+2 vs -2). Wrong winner → 0 points in every stage.",
  },
  {
    title: "France vs Argentina — exact score (knockout R16)",
    match: "France vs Argentina",
    stage: "KNOCKOUT",
    userBet: { exactScore: "2-1" },
    result: { finalScore: "2-1", winner: "HOME" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-1",
        points: 7,
        note: "Exact non-draw score (knockout) → +7",
      },
    ],
    total: 7,
    explanation:
      "An exact non-draw score in a knockout pays +7 (vs +5 in the group stage) — knockout games are rarer and worth more.",
  },
  {
    title: "Brazil vs Croatia — exact draw (knockout R16)",
    match: "Brazil vs Croatia",
    stage: "KNOCKOUT",
    userBet: { exactScore: "1-1" },
    result: { finalScore: "1-1", winner: "DRAW" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "1-1",
        points: 6,
        note: "Exact draw score (knockout) → +6",
      },
    ],
    total: 6,
    explanation:
      "Predicted the exact draw score in a knockout. Draw-exact pays +6 in knockout (vs +5 in the group stage).",
  },
  {
    title: "Croatia vs Brazil — right winner + right goal diff (knockout QF)",
    match: "Croatia vs Brazil",
    stage: "KNOCKOUT",
    userBet: { exactScore: "2-0" },
    result: { finalScore: "3-1", winner: "HOME" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-0",
        points: 3,
        note: "Right winner (HOME) + right signed diff (+2, knockout) → +3",
      },
    ],
    total: 3,
    explanation:
      "Same right-winner + right-diff as a group game, but worth +3 in a knockout instead of +2.",
  },
  {
    title: "Morocco vs Portugal — right winner only (knockout QF)",
    match: "Morocco vs Portugal",
    stage: "KNOCKOUT",
    userBet: { exactScore: "1-0" },
    result: { finalScore: "3-0", winner: "HOME" },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "1-0",
        points: 2,
        note: "Right winner (HOME) but wrong signed diff (+1 vs +3, knockout) → +2",
      },
    ],
    total: 2,
    explanation:
      "Right winner, wrong signed diff — pays +2 in a knockout (vs +1 in the group stage).",
  },
];
