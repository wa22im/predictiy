export type ScoringExampleStage = "GROUP" | "KNOCKOUT";

export type ScoringExampleWinner = "HOME" | "AWAY" | "DRAW";

export type ScoringExamplePenaltyResult = "HOME" | "AWAY" | "NONE" | "BOTH";

export type ScoringExampleBreakdown = {
  market: string;
  pick: string;
  points: number;
  note: string;
};

export type ScoringExample = {
  title: string;
  match: string;
  stage: ScoringExampleStage;
  userBet: {
    exactScore: string;
    halfScoring: string;
    inGamePenalty: "HOME" | "AWAY" | "";
  };
  result: {
    finalScore: string;
    winner: ScoringExampleWinner;
    halfScoring: string;
    inGamePenalty: ScoringExamplePenaltyResult;
  };
  breakdown: ScoringExampleBreakdown[];
  total: number;
  explanation: string;
};

export const SCORING_EXAMPLES: ScoringExample[] = [
  {
    title: "Tunisia vs Canada — your example",
    match: "Tunisia vs Canada",
    stage: "GROUP",
    userBet: {
      exactScore: "3-2",
      halfScoring: "A_1H",
      inGamePenalty: "AWAY",
    },
    result: {
      finalScore: "2-1",
      winner: "HOME",
      halfScoring: "A_2H",
      inGamePenalty: "AWAY",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "3-2",
        points: 1,
        note: "Score wrong, but Tunisia won → winner partial credit +1",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H (Tunisia 1H)",
        points: -1,
        note: "Tunisia actually scored in 2H, not 1H → -1 (per-bet floor)",
      },
      {
        market: "IN_GAME_PENALTY",
        pick: "AWAY (Canada)",
        points: 3,
        note: "Correct — Canada got the penalty → +3",
      },
    ],
    total: 3,
    explanation:
      "Note: without the per-bet floor (which was added later), the HALF_SCORING pick would have been -2, giving a total of +2. The floor protects you from catastrophic losses on a single bet.",
  },
  {
    title: "Brazil vs Argentina — perfect bet",
    match: "Brazil vs Argentina",
    stage: "GROUP",
    userBet: {
      exactScore: "2-1",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "HOME",
    },
    result: {
      finalScore: "2-1",
      winner: "HOME",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "HOME",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-1",
        points: 4,
        note: "Exact match (+3) + winner (+1) = +4",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H,B_2H",
        points: 2,
        note: "Both correct → +2",
      },
      {
        market: "IN_GAME_PENALTY",
        pick: "HOME (Brazil)",
        points: 3,
        note: "Correct → +3",
      },
    ],
    total: 9,
    explanation:
      "Big win — you nailed the score, the half-by-half breakdown, AND the penalty.",
  },
  {
    title: "Mexico vs South Africa — all wrong",
    match: "Mexico vs South Africa",
    stage: "GROUP",
    userBet: {
      exactScore: "2-0",
      halfScoring: "A_1H,B_1H",
      inGamePenalty: "HOME",
    },
    result: {
      finalScore: "1-1",
      winner: "DRAW",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "NONE",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-0",
        points: 0,
        note: "Wrong score, no winner credit (it's a draw)",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H,B_1H",
        points: 0,
        note: "Mexico 1H correct, SA 1H wrong → 1 right, 1 wrong → 0",
      },
      {
        market: "IN_GAME_PENALTY",
        pick: "HOME (Mexico)",
        points: -1,
        note: "Wrong (no penalties awarded) → -1 (per-bet floor)",
      },
    ],
    total: -1,
    explanation:
      "This is the worst case: -1 point total. The per-bet floor protects you from losing more than -1 on any single bet.",
  },
  {
    title: "France vs Spain — no penalties awarded",
    match: "France vs Spain",
    stage: "GROUP",
    userBet: {
      exactScore: "2-1",
      halfScoring: "A_1H,B_1H",
      inGamePenalty: "HOME",
    },
    result: {
      finalScore: "2-1",
      winner: "HOME",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "NONE",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-1",
        points: 4,
        note: "Exact match + winner = +4",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H,B_1H",
        points: 0,
        note: "France 1H correct, Spain 1H wrong → 0",
      },
      {
        market: "IN_GAME_PENALTY",
        pick: "HOME (France)",
        points: -1,
        note: "Wrong (no penalties = void for this market) → -1 (floor)",
      },
    ],
    total: 3,
    explanation:
      "When no penalties are awarded, the IN_GAME_PENALTY market is void — even though your pick was 'wrong', the floor limits the loss to -1.",
  },
  {
    title: "Germany vs Portugal — both teams penalised",
    match: "Germany vs Portugal",
    stage: "GROUP",
    userBet: {
      exactScore: "1-0",
      halfScoring: "A_1H,B_1H",
      inGamePenalty: "HOME",
    },
    result: {
      finalScore: "1-0",
      winner: "HOME",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "BOTH",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "1-0",
        points: 4,
        note: "Exact + winner = +4",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H,B_1H",
        points: 0,
        note: "Germany 1H correct, Portugal 1H wrong → 0",
      },
      {
        market: "IN_GAME_PENALTY",
        pick: "HOME (Germany)",
        points: -1,
        note: "Wrong (both teams got penalties — auto-settle skips this market) → -1 (floor)",
      },
    ],
    total: 3,
    explanation:
      "When BOTH teams get penalties, the market can't be auto-settled — it's skipped with a warning. The floor still applies.",
  },
  {
    title: "USA vs England — knockout stage, different weights",
    match: "USA vs England",
    stage: "KNOCKOUT",
    userBet: {
      exactScore: "2-1",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "HOME",
    },
    result: {
      finalScore: "2-1",
      winner: "HOME",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "HOME",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-1",
        points: 7,
        note: "Knockout scoring: +5 exact + +2 winner = +7",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H,B_2H",
        points: 2,
        note: "Both correct → +2",
      },
      {
        market: "IN_GAME_PENALTY",
        pick: "HOME (USA)",
        points: 3,
        note: "Correct → +3",
      },
    ],
    total: 12,
    explanation:
      "Knockout stage rewards more — exact score is +5 (vs +3 in group) and winner credit is +2 (vs +1).",
  },
  {
    title: "Morocco vs Croatia — big miss with partial credit",
    match: "Morocco vs Croatia",
    stage: "GROUP",
    userBet: {
      exactScore: "3-0",
      halfScoring: "A_1H,B_2H",
      inGamePenalty: "HOME",
    },
    result: {
      finalScore: "0-2",
      winner: "AWAY",
      halfScoring: "A_2H,B_1H",
      inGamePenalty: "NONE",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "3-0",
        points: 0,
        note: "Wrong, Croatia won → 0",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H,B_2H",
        points: -1,
        note: "Both picks wrong (-1 + -1 = -2, clamped to -1)",
      },
      {
        market: "IN_GAME_PENALTY",
        pick: "HOME (Morocco)",
        points: -1,
        note: "Wrong (no penalties) → -1 (floor)",
      },
    ],
    total: -2,
    explanation:
      "The per-bet floor keeps this at -2 instead of -4. The HALF_SCORING market floors at -1 even though both picks were wrong.",
  },
  {
    title: "Japan vs Germany — half-scoring 1-pick (correct)",
    match: "Japan vs Germany",
    stage: "GROUP",
    userBet: {
      exactScore: "2-1",
      halfScoring: "A_1H",
      inGamePenalty: "",
    },
    result: {
      finalScore: "2-1",
      winner: "HOME",
      halfScoring: "A_1H",
      inGamePenalty: "NONE",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "2-1",
        points: 4,
        note: "Exact match (+3) + winner (+1) = +4",
      },
      {
        market: "HALF_SCORING",
        pick: "A_1H",
        points: 1,
        note: "1-pick: Japan 1H correct → +1 (range -1 to +1 for a 1-pick)",
      },
    ],
    total: 5,
    explanation:
      "HALF_SCORING accepts 1 or 2 codes. A single correct pick scores +1; a single wrong pick scores -1 (the per-bet floor still applies).",
  },
  {
    title: "Spain vs Costa Rica — half-scoring 1-pick (wrong)",
    match: "Spain vs Costa Rica",
    stage: "GROUP",
    userBet: {
      exactScore: "3-0",
      halfScoring: "B_1H",
      inGamePenalty: "",
    },
    result: {
      finalScore: "3-0",
      winner: "HOME",
      halfScoring: "A_1H",
      inGamePenalty: "NONE",
    },
    breakdown: [
      {
        market: "EXACT_SCORE",
        pick: "3-0",
        points: 4,
        note: "Exact match (+3) + winner (+1) = +4",
      },
      {
        market: "HALF_SCORING",
        pick: "B_1H",
        points: -1,
        note: "1-pick: Costa Rica 1H wrong → -1 (per-bet floor)",
      },
    ],
    total: 3,
    explanation:
      "A 1-pick HALF_SCORING bet has a range of -1 to +1. The per-bet floor caps a wrong 1-pick at -1, same as a wrong 2-pick.",
  },
];
