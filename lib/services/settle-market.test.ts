import { describe, it, expect, beforeEach, vi } from "vitest";

// `vi.mock` factories are hoisted to the top of the file by vitest, so any
// mock state they touch must itself be hoisted via `vi.hoisted`. This gives
// us a single object that holds the mock fns shared between the factories
// and the test bodies.
const mocks = vi.hoisted(() => {
  // The shared transaction client. We hand the same object to every
  // $transaction callback, and we also expose the same methods on the
  // top-level prisma object so reads done outside the transaction
  // (recoverLegacyStrandedBets's initial market lookup) hit the same mocks.
  const tx = {
    betMarket: { findUnique: vi.fn(), update: vi.fn() },
    match: { update: vi.fn(), findUnique: vi.fn() },
    userBet: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  // The $transaction dispatcher. Tests re-attach the implementation
  // in beforeEach after clearAllMocks wipes it.
  const $transaction = vi.fn();
  // $queryRaw is used by findStrandedBets(). Default returns []; tests
  // override per-call.
  const $queryRaw = vi.fn();
  return {
    revalidateTag: vi.fn(),
    getStrategy: vi.fn(() => ({
      score: () => ({ points: 1, breakdown: "stub" }),
    })),
    tx,
    $transaction,
    $queryRaw,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
}));

vi.mock("@/lib/scoring", () => ({
  getStrategy: mocks.getStrategy,
}));

vi.mock("@/lib/prisma", () => {
  const tx = mocks.tx;
  return {
    prisma: {
      betMarket: { findUnique: tx.betMarket.findUnique, update: tx.betMarket.update },
      match: { update: tx.match.update, findUnique: tx.match.findUnique },
      userBet: { findMany: tx.userBet.findMany, update: tx.userBet.update, updateMany: tx.userBet.updateMany },
      $transaction: mocks.$transaction,
      $queryRaw: mocks.$queryRaw,
    },
  };
});

import { Prisma } from "@/lib/generated/prisma/client";
import {
  settleMarket,
  recoverLegacyStrandedBets,
  findStrandedBets,
  isTransientPrismaError,
  SETTLE_RETRY_BACKOFFS_MS,
  SETTLE_CHUNK_SIZE,
  SettleError,
} from "./settle-market";
const { tx, $transaction, $queryRaw } = mocks;

// ---- helpers -----------------------------------------------------------------
type MarketFixture = {
  id: string;
  type: string;
  isSettled: boolean;
  correctAnswer: string | null;
  match: { id: string; stage: string } | null;
};

function makeMarket(overrides: Partial<MarketFixture> = {}): MarketFixture {
  return {
    id: "mkt-1",
    type: "EXACT_SCORE",
    isSettled: false,
    correctAnswer: null,
    match: null,
    ...overrides,
  };
}

function makeGroupScoringConfig() {
  // Minimal ScoringConfig — the stub strategy ignores the contents.
  return {
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
}

function makeBet(overrides: Partial<{
  id: string;
  marketId: string;
  groupId: string;
  userId: string;
  predictedValue: string;
  pointsAwarded: number | null;
  group: { id: string; name: string; scoringConfig: unknown };
}> = {}) {
  const groupId = overrides.groupId ?? "g1";
  return {
    id: "bet-1",
    marketId: "mkt-1",
    groupId,
    userId: "u1",
    predictedValue: "2-1",
    pointsAwarded: null,
    group: {
      id: groupId,
      name: `Group ${groupId}`,
      scoringConfig: makeGroupScoringConfig(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks wipes the implementation, so re-attach the strategy
  // default and the transaction dispatcher after each test.
  mocks.getStrategy.mockImplementation(() => ({
    score: () => ({ points: 1, breakdown: "stub" }),
  }));
  $transaction.mockImplementation(
    async (cb: (t: typeof tx) => unknown) => cb(tx),
  );
});

// =============================================================================
describe("settleMarket", () => {
  it("happy path: single bet, scores and marks market settled", async () => {
    const market = makeMarket();
    const bet = makeBet();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet]);
    tx.userBet.update.mockResolvedValue({ ...bet, pointsAwarded: 1 });
    tx.userBet.updateMany.mockResolvedValue({ count: 1 });
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.match.update.mockResolvedValue(undefined);

    const result = await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    expect(tx.betMarket.update).toHaveBeenCalledWith({
      where: { id: "mkt-1" },
      data: { correctAnswer: "2-1", isSettled: true },
    });
    expect(tx.userBet.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["bet-1"] } },
      data: { pointsAwarded: 1 },
    });
    // Per-bet update is no longer used.
    expect(tx.userBet.update).not.toHaveBeenCalled();
    // No match → match.update is not called.
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(result.scoredRows).toBe(1);
    expect(result.byGroup).toHaveLength(1);
    expect(result.byGroup[0]).toMatchObject({
      groupId: "g1",
      groupName: "Group g1",
      scoredRows: 1,
      totalPoints: 1,
    });
  });

  it("cross-group: one user in two groups with two UserBet rows on the same market", async () => {
    const market = makeMarket();
    // Single user, two groups, two UserBet rows for the same market.
    // Production scenario: a user in Group A and Group B, each placing
    // a bet on the same market.
    const betGroupA = makeBet({
      id: "bet-A",
      groupId: "gA",
      userId: "u1",
      predictedValue: "2-1",
    });
    const betGroupB = makeBet({
      id: "bet-B",
      groupId: "gB",
      userId: "u1",
      predictedValue: "2-1",
      group: { id: "gB", name: "Group B", scoringConfig: makeGroupScoringConfig() },
    });
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([betGroupA, betGroupB]);
    tx.userBet.update.mockResolvedValue({ ...betGroupA, pointsAwarded: 1 });
    tx.userBet.updateMany.mockResolvedValue({ count: 2 });
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });

    const result = await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    // Both bets get the same pointsAwarded (scoring depends on
    // predictedValue + correctAnswer, not on group), so they collapse
    // into a single updateMany with both IDs in the `in` list.
    expect(tx.userBet.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.userBet.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["bet-A", "bet-B"] } },
      data: { pointsAwarded: 1 },
    });
    // Per-bet update is no longer used.
    expect(tx.userBet.update).not.toHaveBeenCalled();
    expect(result.byGroup).toHaveLength(2);
    const byGroupA = result.byGroup.find((g) => g.groupId === "gA");
    const byGroupB = result.byGroup.find((g) => g.groupId === "gB");
    expect(byGroupA).toMatchObject({ scoredRows: 1, totalPoints: 1 });
    expect(byGroupB).toMatchObject({ scoredRows: 1, totalPoints: 1 });
  });

  it("marks the match FINISHED when the market is anchored to a match", async () => {
    const market = makeMarket({ match: { id: "match-1", stage: "GROUP_STAGE" } });
    const bet = makeBet();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.match.update.mockResolvedValue({ id: "match-1", status: "FINISHED" });
    tx.userBet.update.mockResolvedValue({ ...bet, pointsAwarded: 1 });
    tx.userBet.updateMany.mockResolvedValue({ count: 1 });

    await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: "match-1" },
      data: { status: "FINISHED" },
    });
  });

  it("strategy missing: market is still marked settled, no bets scored", async () => {
    const market = makeMarket({ type: "OBSOLETE_TYPE" });
    const bet = makeBet();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.match.update.mockResolvedValue(undefined);
    // getStrategy throws for this obsolete type.
    mocks.getStrategy.mockImplementation(() => {
      throw new Error("No scoring strategy for market type: OBSOLETE_TYPE");
    });

    const result = await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    expect(tx.betMarket.update).toHaveBeenCalledWith({
      where: { id: "mkt-1" },
      data: { correctAnswer: "2-1", isSettled: true },
    });
    expect(tx.userBet.updateMany).not.toHaveBeenCalled();
    expect(tx.userBet.update).not.toHaveBeenCalled();
    expect(result.scoredRows).toBe(0);
    expect(result.byGroup).toEqual([]);
  });

  it("throws ALREADY_SETTLED on a market that has been settled before", async () => {
    const market = makeMarket({ isSettled: true, correctAnswer: "1-0" });
    tx.betMarket.findUnique.mockResolvedValue(market);

    await expect(
      settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" }),
    ).rejects.toBeInstanceOf(SettleError);
    await expect(
      settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" }),
    ).rejects.toMatchObject({ status: 409, message: "ALREADY_SETTLED" });
    // No writes happened — the throw is inside the transaction.
    expect(tx.betMarket.update).not.toHaveBeenCalled();
    expect(tx.userBet.update).not.toHaveBeenCalled();
    expect(tx.userBet.updateMany).not.toHaveBeenCalled();
  });

  it("calls revalidateTag('group-leaderboard') exactly once after the transaction commits", async () => {
    const market = makeMarket();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });

    await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    expect(mocks.revalidateTag).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("group-leaderboard");
  });
});

// =============================================================================
describe("settleMarket chunked + grouped updateMany", () => {
  it("groups bets with the same pointsAwarded into one updateMany", async () => {
    const market = makeMarket();
    // 3 bets, all with predictedValue "2-1" and correctAnswer "2-1",
    // so the stub strategy returns points=1 for all. They should
    // be grouped into ONE updateMany with all 3 bet IDs.
    const bet1 = makeBet({ id: "bet-1", groupId: "g1" });
    const bet2 = makeBet({ id: "bet-2", groupId: "g1" });
    const bet3 = makeBet({ id: "bet-3", groupId: "g1" });
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet1, bet2, bet3]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.userBet.updateMany.mockResolvedValue({ count: 3 });

    const result = await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    // ONE updateMany for the single point value (1), with all 3 bet IDs.
    expect(tx.userBet.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.userBet.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["bet-1", "bet-2", "bet-3"] } },
      data: { pointsAwarded: 1 },
    });
    // Per-bet update is no longer used.
    expect(tx.userBet.update).not.toHaveBeenCalled();
    expect(result.scoredRows).toBe(3);
  });

  it("issues one updateMany per distinct pointsAwarded value", async () => {
    const market = makeMarket();
    // 3 bets. The stub strategy always returns points=1, so we need
    // to override it for this test to return distinct points per call.
    const bet1 = makeBet({ id: "bet-1", groupId: "g1" });
    const bet2 = makeBet({ id: "bet-2", groupId: "g1" });
    const bet3 = makeBet({ id: "bet-3", groupId: "g1" });
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet1, bet2, bet3]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.userBet.updateMany.mockResolvedValue({ count: 1 });
    // Mock the strategy to return 1, 2, 1 in sequence → 2 distinct values.
    let i = 0;
    const pointsSequence = [1, 2, 1];
    mocks.getStrategy.mockImplementation(() => ({
      score: () => {
        const points = pointsSequence[i++] ?? 1;
        return { points, breakdown: `mock ${points}` };
      },
    }));

    await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    // Two distinct point values (1 and 2) → two updateMays.
    expect(tx.userBet.updateMany).toHaveBeenCalledTimes(2);
    // Call 1: { points: 1, ids: [bet-1, bet-3] }  (both got 1)
    // Call 2: { points: 2, ids: [bet-2] }
    const calls = tx.userBet.updateMany.mock.calls.map(
      (c) => c[0] as { where: { id: { in: string[] } }; data: { pointsAwarded: number } },
    );
    const group1 = calls.find((c) => c.data.pointsAwarded === 1);
    const group2 = calls.find((c) => c.data.pointsAwarded === 2);
    expect(group1?.where.id.in.sort()).toEqual(["bet-1", "bet-3"]);
    expect(group2?.where.id.in).toEqual(["bet-2"]);
  });

  it("chunks updateMany calls at SETTLE_CHUNK_SIZE (100 bet IDs per call)", async () => {
    const market = makeMarket();
    // 250 bets all returning points=1 → 1 distinct value → 3 chunks
    // (100 + 100 + 50). Stub strategy returns points=1 for all.
    const bets = Array.from({ length: 250 }, (_, i) =>
      makeBet({ id: `bet-${i}`, groupId: "g1" }),
    );
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue(bets);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.userBet.updateMany.mockResolvedValue({ count: 100 });

    const result = await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    // 250 / 100 = 2.5 → ceil = 3 updateMays
    expect(tx.userBet.updateMany).toHaveBeenCalledTimes(3);
    // Check chunk sizes: 100, 100, 50.
    const chunkSizes = tx.userBet.updateMany.mock.calls.map(
      (c) => (c[0] as { where: { id: { in: string[] } } }).where.id.in.length,
    );
    expect(chunkSizes).toEqual([100, 100, 50]);
    expect(result.scoredRows).toBe(250);
  });

  it("chunks at the exact boundary (100 bets → 1 chunk, 101 bets → 2 chunks)", async () => {
    // Test both boundary cases to catch off-by-one errors.
    for (const betCount of [100, 101]) {
      vi.clearAllMocks();
      // Re-attach defaults after clearAllMocks.
      mocks.getStrategy.mockImplementation(() => ({
        score: () => ({ points: 1, breakdown: "stub" }),
      }));
      $transaction.mockImplementation(async (cb) => cb(tx));

      const market = makeMarket();
      const bets = Array.from({ length: betCount }, (_, i) =>
        makeBet({ id: `bet-${i}`, groupId: "g1" }),
      );
      tx.betMarket.findUnique.mockResolvedValue(market);
      tx.userBet.findMany.mockResolvedValue(bets);
      tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
      tx.userBet.updateMany.mockResolvedValue({ count: 100 });

      const result = await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

      const expectedChunks = betCount === 100 ? 1 : 2;
      expect(tx.userBet.updateMany).toHaveBeenCalledTimes(expectedChunks);
      expect(result.scoredRows).toBe(betCount);
    }
  });

  it("still applies the per-bet -1 floor before grouping", async () => {
    const market = makeMarket();
    // Mock the strategy to return points=-5 (below the floor).
    // The clampedPoints should be -1, not -5.
    const bet = makeBet({ id: "bet-1", groupId: "g1" });
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.userBet.updateMany.mockResolvedValue({ count: 1 });
    mocks.getStrategy.mockImplementation(() => ({
      score: () => ({ points: -5, breakdown: "very wrong" }),
    }));

    await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    expect(tx.userBet.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["bet-1"] } },
      data: { pointsAwarded: -1 }, // floor applied
    });
  });

  it("byGroupMap totals are correct after chunked update", async () => {
    const market = makeMarket();
    // 3 bets across 2 groups, all scoring points=2.
    // Group g1 has 2 bets (total 4), group g2 has 1 bet (total 2).
    const bet1 = makeBet({ id: "bet-1", groupId: "g1" });
    const bet2 = makeBet({ id: "bet-2", groupId: "g1" });
    const bet3 = makeBet({
      id: "bet-3",
      groupId: "g2",
      group: { id: "g2", name: "Group B", scoringConfig: makeGroupScoringConfig() },
    });
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet1, bet2, bet3]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });
    tx.userBet.updateMany.mockResolvedValue({ count: 3 });
    mocks.getStrategy.mockImplementation(() => ({
      score: () => ({ points: 2, breakdown: "stub" }),
    }));

    const result = await settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" });

    expect(result.byGroup).toHaveLength(2);
    const g1 = result.byGroup.find((g) => g.groupId === "g1");
    const g2 = result.byGroup.find((g) => g.groupId === "g2");
    expect(g1).toMatchObject({ scoredRows: 2, totalPoints: 4 });
    expect(g2).toMatchObject({ scoredRows: 1, totalPoints: 2 });
  });

  it("SETTLE_CHUNK_SIZE is exactly 100", () => {
    expect(SETTLE_CHUNK_SIZE).toBe(100);
  });
});

// =============================================================================
describe("recoverLegacyStrandedBets", () => {
  it("recovers stranded bets on a settled market", async () => {
    const market = makeMarket({ isSettled: true, correctAnswer: "2-1" });
    const stranded = makeBet({ id: "bet-stranded", pointsAwarded: null });
    // recoverLegacyStrandedBets reads the market first via prisma.betMarket.findUnique.
    tx.betMarket.findUnique.mockResolvedValue(market);
    // Inside the transaction: findMany with pointsAwarded: null returns only stranded.
    tx.userBet.findMany.mockResolvedValue([stranded]);
    // No matchId → match.findUnique is not called (we use the OUTRIGHT fallback).
    tx.userBet.update.mockResolvedValue({ ...stranded, pointsAwarded: 1 });

    const result = await recoverLegacyStrandedBets("mkt-1");

    // Only the stranded row was updated.
    expect(tx.userBet.update).toHaveBeenCalledTimes(1);
    expect(tx.userBet.update).toHaveBeenCalledWith({
      where: { id: "bet-stranded" },
      data: { pointsAwarded: 1 },
    });
    // Market was NOT re-flagged (it was already settled).
    expect(tx.betMarket.update).not.toHaveBeenCalled();
    expect(result).toEqual({ recoveredRows: 1 });
  });

  it("returns recoveredRows: 0 when no bets are stranded", async () => {
    const market = makeMarket({ isSettled: true, correctAnswer: "2-1" });
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([]); // findMany with pointsAwarded: null returns []

    const result = await recoverLegacyStrandedBets("mkt-1");

    expect(tx.userBet.update).not.toHaveBeenCalled();
    expect(result).toEqual({ recoveredRows: 0 });
  });

  it("throws MARKET_NOT_SETTLED when called on a market that is not yet settled", async () => {
    const market = makeMarket({ isSettled: false });
    tx.betMarket.findUnique.mockResolvedValue(market);

    // Note: vi.clearAllMocks in beforeEach has already reset the
    // $transaction call history, so a single settle attempt gives a
    // clean baseline.
    await expect(recoverLegacyStrandedBets("mkt-1")).rejects.toBeInstanceOf(SettleError);
    await expect(recoverLegacyStrandedBets("mkt-1")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("MARKET_NOT_SETTLED"),
    });
    // No transaction was opened for the not-settled case.
    expect($transaction).not.toHaveBeenCalled();
  });
});

// =============================================================================
describe("findStrandedBets", () => {
  it("maps raw query rows into StrandedMarket objects with Number counts", async () => {
    $queryRaw.mockResolvedValue([
      { marketId: "mkt-A", marketType: "EXACT_SCORE", strandedCount: BigInt(3) },
      { marketId: "mkt-B", marketType: "OUTRIGHT_WINNER", strandedCount: BigInt(1) },
    ]);

    const result = await findStrandedBets();

    expect(result).toEqual([
      { marketId: "mkt-A", marketType: "EXACT_SCORE", strandedCount: 3 },
      { marketId: "mkt-B", marketType: "OUTRIGHT_WINNER", strandedCount: 1 },
    ]);
  });

  it("returns [] when no stranded markets are found", async () => {
    $queryRaw.mockResolvedValue([]);

    const result = await findStrandedBets();

    expect(result).toEqual([]);
  });
});

// =============================================================================
describe("settleMarket retry behavior", () => {
  // Helper: build a real Prisma.PrismaClientKnownRequestError instance.
  // We avoid calling the constructor (which requires a structured params
  // object including clientVersion) by using Object.create on the
  // prototype. The production `isTransientPrismaError` only reads
  // `.code`, so this is sufficient to drive the retry path.
  function makeKnownError(code: string, message = `prisma error ${code}`) {
    const e = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    e.message = message;
    e.code = code;
    return e;
  }

  function makeUnknownError(message = "unknown prisma error") {
    const e = Object.create(Prisma.PrismaClientUnknownRequestError.prototype);
    e.message = message;
    return e;
  }

  it("retries on transient PrismaClientKnownRequestError, succeeds on attempt 2", async () => {
    const market = makeMarket();
    const bet = makeBet();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([bet]);
    tx.userBet.update.mockResolvedValue({ ...bet, pointsAwarded: 1 });
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });

    const transientErr = makeKnownError("P1001", "Can't reach DB");
    $transaction
      .mockImplementationOnce(async () => {
        throw transientErr;
      })
      .mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    const noopSleep = vi.fn(async () => {});

    const result = await settleMarket(
      { marketId: "mkt-1", correctAnswer: "2-1" },
      { sleep: noopSleep },
    );

    expect($transaction).toHaveBeenCalledTimes(2);
    expect(noopSleep).toHaveBeenCalledTimes(1);
    expect(noopSleep).toHaveBeenCalledWith(1000);
    expect(result.scoredRows).toBe(1);
  });

  it("uses the backoff schedule [1000, 1500, 3000]", async () => {
    const market = makeMarket();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });

    const transientErr = makeKnownError("P1002");
    $transaction.mockImplementation(async () => {
      throw transientErr;
    });

    const sleepCalls: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });

    await expect(
      settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" }, { sleep }),
    ).rejects.toBe(transientErr);

    // 1 initial + 3 retries = 4 attempts; 3 backoff sleeps in order.
    expect($transaction).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleepCalls).toEqual([1000, 1500, 3000]);
  });

  it("re-throws the last error after 3 failed retries", async () => {
    const market = makeMarket();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });

    const lastErr = makeKnownError("P2034");
    $transaction.mockImplementation(async () => {
      throw lastErr;
    });

    const sleep = vi.fn(async () => {});

    await expect(
      settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" }, { sleep }),
    ).rejects.toBe(lastErr);

    expect($transaction).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on a non-transient error (no retry)", async () => {
    const market = makeMarket();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });

    const logicErr = new Error("logic error");
    $transaction.mockImplementation(async () => {
      throw logicErr;
    });

    const sleep = vi.fn(async () => {});

    await expect(
      settleMarket({ marketId: "mkt-1", correctAnswer: "2-1" }, { sleep }),
    ).rejects.toBe(logicErr);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries on PrismaClientUnknownRequestError (safety net)", async () => {
    const market = makeMarket();
    tx.betMarket.findUnique.mockResolvedValue(market);
    tx.userBet.findMany.mockResolvedValue([]);
    tx.betMarket.update.mockResolvedValue({ ...market, isSettled: true });

    const unknownErr = makeUnknownError("connection reset mid-deploy");
    $transaction
      .mockImplementationOnce(async () => {
        throw unknownErr;
      })
      .mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    const sleep = vi.fn(async () => {});

    const result = await settleMarket(
      { marketId: "mkt-1", correctAnswer: "2-1" },
      { sleep },
    );

    expect($transaction).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result.scoredRows).toBe(0);
  });

  it("isTransientPrismaError returns true for transient codes, false for others", () => {
    const makeKnown = (code: string) => {
      const e = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
      e.code = code;
      e.message = `code ${code}`;
      return e;
    };
    expect(isTransientPrismaError(makeKnown("P1001"))).toBe(true);
    expect(isTransientPrismaError(makeKnown("P1002"))).toBe(true);
    expect(isTransientPrismaError(makeKnown("P1008"))).toBe(true);
    expect(isTransientPrismaError(makeKnown("P2034"))).toBe(true);
    // Non-transient codes:
    expect(isTransientPrismaError(makeKnown("P2002"))).toBe(false); // unique violation
    expect(isTransientPrismaError(makeKnown("P2025"))).toBe(false); // not found
    // Non-Prisma errors:
    expect(isTransientPrismaError(new Error("generic"))).toBe(false);
    expect(isTransientPrismaError(null)).toBe(false);
    // Unknown request error is treated as transient (safety net).
    const unknown = Object.create(Prisma.PrismaClientUnknownRequestError.prototype);
    unknown.message = "unknown";
    expect(isTransientPrismaError(unknown)).toBe(true);
  });

  it("SETTLE_RETRY_BACKOFFS_MS is exactly [1000, 1500, 3000]", () => {
    expect(SETTLE_RETRY_BACKOFFS_MS).toEqual([1000, 1500, 3000]);
  });
});
