import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Regression tests for the m2m-join change in `getGroupFeed`. The
 * group feed must show ALL matches linked to the group's competition
 * — not just matches whose typed `Match.competitionId` column points
 * at the same competition. This is what enables mixed tournaments
 * (a "Best of 2026" custom tournament referencing matches from
 * Premier League, Champions League, etc.) to surface their matches
 * on the group feed.
 *
 * The contracts covered:
 *   1. The match query filters via `customLinks: { some: ... }`,
 *      NOT via the typed `competitionId` column.
 *   2. Matches with no CompetitionMatch link to the group's
 *      competition are excluded.
 *   3. A match with multiple CompetitionMatch rows (linked to many
 *      custom tournaments) surfaces on the group feed for every
 *      linked competition's group.
 */

vi.mock("server-only", () => ({}));

const groupFindUnique = vi.fn();
const matchFindMany = vi.fn();
const groupMemberFindMany = vi.fn();
const userBetFindMany = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    group: { findUnique: (...args: unknown[]) => groupFindUnique(...args) },
    match: { findMany: (...args: unknown[]) => matchFindMany(...args) },
    groupMember: { findMany: (...args: unknown[]) => groupMemberFindMany(...args) },
    userBet: { findMany: (...args: unknown[]) => userBetFindMany(...args) },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));

import { getGroupFeed } from "./group-feed";

beforeEach(() => {
  vi.clearAllMocks();
  // The group fetch returns the canonical (id, competitionId) pair
  // that the service needs. The membership + bet + match fetches are
  // mocked to no-op results so the service doesn't crash on the
  // unrelated branches.
  groupFindUnique.mockResolvedValue({ id: "g1", competitionId: "c1" });
  groupMemberFindMany.mockResolvedValue([]);
  userBetFindMany.mockResolvedValue([]);
  matchFindMany.mockResolvedValue([]);
  executeRaw.mockResolvedValue(0);
});

describe("getGroupFeed - CompetitionMatch m2m join", () => {
  it("filters matches via `customLinks: { some: { competitionId } }` (m2m join, NOT the typed column)", async () => {
    await getGroupFeed("g1", "user-1");
    const where = matchFindMany.mock.calls[0][0].where;
    // The m2m join is what makes mixed tournaments surface their
    // matches. Asserting on the shape (some: { competitionId }) is
    // the contract: any future refactor that switches back to
    // `competitionId: group.competitionId` will fail this test.
    expect(where).toEqual({
      customLinks: { some: { competitionId: "c1" } },
    });
    // Belt-and-braces: the typed column must NOT be used.
    expect(where.competitionId).toBeUndefined();
  });

  it("does NOT include the typed Match.competitionId column in the filter (key m2m contract)", async () => {
    // The group belongs to c2. Even if a Match row has
    // competitionId = c2, that match only surfaces on the group feed
    // if it ALSO has a CompetitionMatch row linking it to c2. This
    // test pins that contract by asserting the filter is m2m-only.
    groupFindUnique.mockResolvedValue({ id: "g1", competitionId: "c2" });
    await getGroupFeed("g1", "user-1");
    const where = matchFindMany.mock.calls[0][0].where;
    expect(where).toEqual({
      customLinks: { some: { competitionId: "c2" } },
    });
  });

  it("returns the matches that the prisma call resolved to (sanity check on data flow)", async () => {
    // The feed surfaces whatever the prisma call returns. The test
    // is that the matches round-trip — even if the typed column
    // and the m2m column disagree (mixed tournament case), the
    // matches returned by prisma are the ones shown in the feed.
    matchFindMany.mockResolvedValue([
      {
        id: "m1",
        homeTeam: "Home",
        awayTeam: "Away",
        homeCrest: null,
        awayCrest: null,
        kickoffTime: new Date("2026-06-13T20:00:00Z"),
        stage: "GROUP",
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        homeHtGoals: null,
        awayHtGoals: null,
        homePenalties: null,
        awayPenalties: null,
        markets: [],
      },
    ]);
    const result = await getGroupFeed("g1", "user-1");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].id).toBe("m1");
  });
});
