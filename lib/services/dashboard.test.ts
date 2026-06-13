import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock server-only so the service module is importable in unit tests.
vi.mock("server-only", () => ({}));

const groupMemberFindMany = vi.fn();
const matchFindMany = vi.fn();
const userBetFindMany = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    groupMember: { findMany: (...args: unknown[]) => groupMemberFindMany(...args) },
    match: { findMany: (...args: unknown[]) => matchFindMany(...args) },
    userBet: { findMany: (...args: unknown[]) => userBetFindMany(...args) },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));

import { getDashboardData } from "./dashboard";

/**
 * The service calls groupMember.findMany twice in parallel (memberships,
 * then all members). Because the two calls are dispatched in a
 * `Promise.all`, the mock has to discriminate by the `where.userId`
 * shape: the membership lookup filters on the viewer's id, while the
 * "all members" lookup filters on `groupId.in`. We pick the right
 * fixture by inspecting the call arg.
 */
function setupMembers(memberships: unknown[], allMembers: unknown[] = []) {
  groupMemberFindMany.mockImplementation(async (arg: { where?: { userId?: string; groupId?: { in?: string[] } } }) => {
    if (arg?.where?.groupId?.in) return allMembers;
    return memberships;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no bets in the system. Tests that care about bets
  // override this with mockResolvedValueOnce.
  userBetFindMany.mockResolvedValue([]);
  // Default: reveal call is a no-op. Tests that care about the
  // reveal call override with mockResolvedValueOnce.
  executeRaw.mockResolvedValue(0);
});

describe("getDashboardData", () => {
  it("returns no groups and no queries when the user has no memberships", async () => {
    setupMembers([]);

    const result = await getDashboardData("user-1");

    expect(result.groups).toEqual([]);
    expect(matchFindMany).not.toHaveBeenCalled();
    expect(userBetFindMany).not.toHaveBeenCalled();
  });

  it("includes only groups that have at least one unsettled match", async () => {
    setupMembers([
      // Two groups in the same competition, one in another.
      membership("g1", "Group A", "c1", "World Cup", 3),
      membership("g2", "Group B", "c1", "World Cup", 5),
      membership("g3", "Empty Group", "c2", "Champions League", 2),
    ]);
    // c1 has an unsettled match, c2 has none.
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "m1", competitionId: "c1", status: "GOING" }),
    ]);

    const result = await getDashboardData("user-1");

    const groupIds = result.groups.map((g) => g.id).sort();
    expect(groupIds).toEqual(["g1", "g2"]);
    // c2 is fully settled, so it doesn't appear.
    expect(result.groups.find((g) => g.id === "g3")).toBeUndefined();
  });

  it("uses a WHERE status filter that excludes FINISHED (settled matches never surface)", async () => {
    setupMembers([membership("g1", "Group A", "c1", "World Cup", 3)]);
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "m1", competitionId: "c1", status: "GOING" }),
    ]);

    await getDashboardData("user-1");

    const where = matchFindMany.mock.calls[0][0].where;
    expect(where.status.in).toContain("SCHEDULED");
    expect(where.status.in).toContain("GOING");
    expect(where.status.in).not.toContain("FINISHED");
  });

  it("sorts unsettled matches by kickoffTime ASC (chronological, past first)", async () => {
    // Replaces the prior "GOING before SCHEDULED" test. The new
    // contract: unsettled matches are sorted purely by kickoffTime
    // ASC (oldest first), regardless of status. The 2-finished
    // trailing cap is exercised in a separate test.
    setupMembers([membership("g1", "Group A", "c1", "World Cup", 3)]);
    // Three unsettled matches with arbitrary statuses and kickoff
    // times. The service must sort purely by kickoffTime ASC; status
    // does NOT affect order.
    matchFindMany.mockResolvedValueOnce([
      makeMatch({
        id: "m-late-sched",
        competitionId: "c1",
        status: "SCHEDULED",
        kickoffTime: new Date("2026-06-15T20:00:00Z"),
      }),
      makeMatch({
        id: "m-going",
        competitionId: "c1",
        status: "GOING",
        kickoffTime: new Date("2026-06-13T19:00:00Z"),
      }),
      makeMatch({
        id: "m-early-sched",
        competitionId: "c1",
        status: "SCHEDULED",
        kickoffTime: new Date("2026-06-14T20:00:00Z"),
      }),
    ]);

    const result = await getDashboardData("user-1");
    const order = result.groups[0].matches.map((m) => m.id);
    // Pure kickoff ASC: June 13 (m-going), June 14 (m-early-sched),
    // June 15 (m-late-sched). Status (GOING vs SCHEDULED) does not
    // affect order.
    expect(order).toEqual(["m-going", "m-early-sched", "m-late-sched"]);
  });

  it("caps each group to a maximum of 10 matches (8 unsettled + 2 finished)", async () => {
    // Case A: 12 unsettled, 0 finished → 8 total (unsettled capped to 8)
    setupMembers([membership("g1", "Group A", "c1", "World Cup", 3)]);
    const twelveUnsettled = Array.from({ length: 12 }, (_, i) =>
      makeMatch({
        id: `m${i}`,
        competitionId: "c1",
        status: "SCHEDULED",
        kickoffTime: new Date(`2026-06-${String((i % 9) + 1).padStart(2, "0")}T20:00:00Z`),
      }),
    );
    matchFindMany.mockResolvedValueOnce(twelveUnsettled);
    const result = await getDashboardData("user-1");
    expect(result.groups[0].matches).toHaveLength(8);
    // And all 8 should be unsettled (no FINISHED in input)
    for (const m of result.groups[0].matches) {
      expect(m.status).not.toBe("FINISHED");
    }
  });

  it("prepends up to 2 most-recent finished matches before the unsettled ones", async () => {
    // 2 unsettled, 5 finished → 2 finished + 2 unsettled = 4 total
    setupMembers([membership("g1", "Group A", "c1", "World Cup", 3)]);
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "u1", competitionId: "c1", status: "GOING", kickoffTime: new Date("2026-06-14T20:00:00Z") }),
      makeMatch({ id: "u2", competitionId: "c1", status: "SCHEDULED", kickoffTime: new Date("2026-06-15T20:00:00Z") }),
      makeMatch({ id: "f1", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-10T20:00:00Z") }),
      makeMatch({ id: "f2", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-11T20:00:00Z") }),
      makeMatch({ id: "f3", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-12T20:00:00Z") }),
      makeMatch({ id: "f4", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-08T20:00:00Z") }),
      makeMatch({ id: "f5", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-09T20:00:00Z") }),
    ]);
    const result = await getDashboardData("user-1");
    const matches = result.groups[0].matches;
    expect(matches).toHaveLength(4);
    // Order: 2 most-recent finished PREPENDED at the top, then
    // unsettled chronological by kickoffTime ASC. u1 (June 14)
    // precedes u2 (June 15) by kickoff ASC. The finished block is
    // the 2 most-recent (f3 = June 12, f2 = June 11).
    expect(matches.map((m) => m.id)).toEqual(["f3", "f2", "u1", "u2"]);
  });

  it("caps unsettled to 8 even when 9+ are present, with finished leading", async () => {
    // 9 unsettled + 5 finished → 2 finished + 8 unsettled = 10 total
    setupMembers([membership("g1", "Group A", "c1", "World Cup", 3)]);
    matchFindMany.mockResolvedValueOnce([
      // 9 unsettled, sorted in arbitrary order — the service sorts them
      ...Array.from({ length: 9 }, (_, i) =>
        makeMatch({
          id: `u${i}`,
          competitionId: "c1",
          status: "SCHEDULED",
          kickoffTime: new Date(`2026-06-${String(i + 1).padStart(2, "0")}T20:00:00Z`),
        }),
      ),
      // 5 finished, various kickoff times
      makeMatch({ id: "f1", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-01T20:00:00Z") }),
      makeMatch({ id: "f2", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-02T20:00:00Z") }),
      makeMatch({ id: "f3", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-03T20:00:00Z") }),
      makeMatch({ id: "f4", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-04T20:00:00Z") }),
      makeMatch({ id: "f5", competitionId: "c1", status: "FINISHED", kickoffTime: new Date("2026-06-05T20:00:00Z") }),
    ]);
    const result = await getDashboardData("user-1");
    const matches = result.groups[0].matches;
    expect(matches).toHaveLength(10);
    // 2 most-recent finished come first, then 8 unsettled
    expect(matches.slice(2, 10).every((m) => m.status !== "FINISHED")).toBe(true);
    expect(matches.slice(0, 2).every((m) => m.status === "FINISHED")).toBe(true);
    // The 2 finished are the most recent (f5 then f4 by kickoff desc)
    expect(matches[0].id).toBe("f5");
    expect(matches[1].id).toBe("f4");
  });

  it("issues at most 3 batched queries (no N+1)", async () => {
    setupMembers([
      membership("g1", "Group A", "c1", "World Cup", 3),
      membership("g2", "Group B", "c2", "Euro Cup", 3),
    ]);
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "m1", competitionId: "c1", status: "GOING" }),
    ]);
    userBetFindMany.mockResolvedValueOnce([]);

    await getDashboardData("user-1");

    // One query per top-level entity, no per-group loops.
    // (groupMember.findMany runs twice: memberships, then all members.)
    expect(groupMemberFindMany).toHaveBeenCalledTimes(2);
    expect(matchFindMany).toHaveBeenCalledTimes(1);
    expect(userBetFindMany).toHaveBeenCalledTimes(1);
  });

  it("uses IN filters so the database can serve the read in one round trip", async () => {
    setupMembers([
      membership("g1", "Group A", "c1", "World Cup", 3),
      membership("g2", "Group B", "c2", "Euro Cup", 3),
    ]);
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "m1", competitionId: "c1", status: "GOING" }),
    ]);
    userBetFindMany.mockResolvedValueOnce([]);

    await getDashboardData("user-1");

    const matchWhere = matchFindMany.mock.calls[0][0].where;
    expect(matchWhere.competitionId.in).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(matchWhere.status.in).toEqual(expect.arrayContaining(["SCHEDULED", "GOING"]));

    const betWhere = userBetFindMany.mock.calls[0][0].where;
    expect(betWhere.groupId.in).toEqual(expect.arrayContaining(["g1", "g2"]));
    expect(betWhere.marketId.in).toEqual(expect.arrayContaining(["mk1"]));
  });

  it("returns payload fields (serverNow, lockdownMs) the UI uses for countdowns", async () => {
    setupMembers([membership("g1", "Group A", "c1", "World Cup", 3)]);
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "m1", competitionId: "c1", status: "GOING" }),
    ]);
    userBetFindMany.mockResolvedValueOnce([]);

    const result = await getDashboardData("user-1");

    expect(result.serverNow).toBeTruthy();
    expect(result.lockdownMs).toBeGreaterThan(0);
    // First group's first match has an ISO kickoffTime, isLocked, and markets.
    const m = result.groups[0].matches[0];
    expect(typeof m.kickoffTime).toBe("string");
    expect(typeof m.isLocked).toBe("boolean");
    expect(Array.isArray(m.markets)).toBe(true);
  });

  it("populates otherBets with all group members' bets for each market (anti-snoop mask applied)", async () => {
    // Group g1 has 2 members: the viewer (user-1) and one other user.
    // The other user's bet is on mk1. The viewer is excluded from
    // otherBets (they see their own bet via viewerBet).
    setupMembers([
      membership("g1", "Group A", "c1", "World Cup", 2, [
        { id: "user-2", nickname: "Rival", emoji: "🐺" },
      ]),
    ]);
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "m1", competitionId: "c1", status: "GOING" }),
    ]);
    userBetFindMany.mockResolvedValueOnce([
      {
        id: "ub-viewer",
        userId: "user-1",
        groupId: "g1",
        marketId: "mk1",
        predictedValue: "2-1",
        pointsAwarded: null,
        isRevealed: true,
        updatedAt: new Date(),
      },
      {
        id: "ub-other",
        userId: "user-2",
        groupId: "g1",
        marketId: "mk1",
        predictedValue: "1-0",
        pointsAwarded: null,
        isRevealed: true,
        updatedAt: new Date(),
      },
    ]);

    const result = await getDashboardData("user-1");
    const market = result.groups[0].matches[0].markets[0];
    // one otherBet (the rival's bet). The viewer is excluded.
    expect(market.otherBets).toHaveLength(1);
    expect(market.otherBets[0].userId).toBe("user-2");
    expect(market.otherBets[0].nickname).toBe("Rival");
    expect(market.otherBets[0].predictedValue).toBe("1-0");
    expect(market.otherBets[0].isMasked).toBe(false);
  });

  it("masks otherBets with 🔒 when the bet is not yet revealed (locked match)", async () => {
    // The match is locked (kickoff is < 5 min away) and the rival's
    // bet is still isRevealed: false. The dashboard's reveal call
    // covers locked/finished matches, so the bet stays masked in
    // this test because we mock executeRaw as a no-op.
    setupMembers([
      membership("g1", "Group A", "c1", "World Cup", 2, [
        { id: "user-2", nickname: "Rival", emoji: "🐺" },
      ]),
    ]);
    // Kickoff is 2 minutes from now → locked.
    const soon = new Date(Date.now() + 2 * 60 * 1000);
    matchFindMany.mockResolvedValueOnce([
      makeMatch({ id: "m1", competitionId: "c1", status: "SCHEDULED", kickoffTime: soon }),
    ]);
    userBetFindMany.mockResolvedValueOnce([
      {
        id: "ub-other",
        userId: "user-2",
        groupId: "g1",
        marketId: "mk1",
        predictedValue: "1-0",
        pointsAwarded: null,
        isRevealed: false,
        updatedAt: new Date(),
      },
    ]);

    const result = await getDashboardData("user-1");
    const market = result.groups[0].matches[0].markets[0];
    expect(market.otherBets).toHaveLength(1);
    expect(market.otherBets[0].isMasked).toBe(true);
    expect(market.otherBets[0].predictedValue).toBe("🔒");
  });
});

function membership(
  groupId: string,
  name: string,
  competitionId: string,
  competitionName: string,
  memberCount: number,
  extraMembers: { id: string; nickname: string; emoji: string }[] = [],
) {
  const memberRows = [
    {
      id: `gm-viewer-${groupId}`,
      userId: "user-1",
      groupId,
      joinedAt: new Date("2026-01-01T00:00:00Z"),
      user: { id: "user-1", nickname: "Viewer", emoji: "🦅" },
    },
    ...extraMembers.map((u, i) => ({
      id: `gm-other-${groupId}-${i}`,
      userId: u.id,
      groupId,
      joinedAt: new Date(`2026-01-0${i + 2}T00:00:00Z`),
      user: { id: u.id, nickname: u.nickname, emoji: u.emoji },
    })),
  ];
  return {
    userId: "user-1",
    groupId,
    joinedAt: new Date(),
    id: `gm-${groupId}`,
    group: {
      id: groupId,
      name,
      competitionId,
      inviteCode: `code-${groupId}`,
      scoringConfig: {},
      createdAt: new Date(),
      competition: { id: competitionId, name: competitionName },
      _count: { members: memberCount },
      members: memberRows,
    },
  };
}

function makeMatch(over: {
  id: string;
  competitionId: string;
  status: "SCHEDULED" | "GOING" | "FINISHED";
  kickoffTime?: Date;
}) {
  return {
    id: over.id,
    competitionId: over.competitionId,
    apiMatchId: `api-${over.id}`,
    homeTeam: "Home",
    awayTeam: "Away",
    homeCrest: null,
    awayCrest: null,
    kickoffTime: over.kickoffTime ?? new Date("2026-06-13T20:00:00Z"),
    stage: "GROUP",
    status: over.status,
    homeScore: null,
    awayScore: null,
    homeHtGoals: null,
    awayHtGoals: null,
    homePenalties: null,
    awayPenalties: null,
    externalStatus: null,
    markets: [
      {
        id: "mk1",
        type: "EXACT_SCORE",
        title: "Predict the final score",
        options: null,
        correctAnswer: null,
        isSettled: false,
        matchId: over.id,
      },
    ],
  };
}
