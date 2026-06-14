import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for `DELETE /api/v1/admin/competitions/[id]/matches/[matchId]`
 * — the remove-match endpoint. The route:
 *   - gates on requireAuth (401) — open to all logged-in users
 *   - validates id + matchId
 *   - 404 when the match doesn't exist
 *   - 400 MATCH_ALREADY_PLAYED if kickoffTime has passed OR
 *     status === FINISHED
 *   - deleteMany on CompetitionMatch; idempotent (removed: false
 *     when the row was already gone)
 *
 * Auth model: as of the "manage-matches-public" round, any
 * authenticated user (admin or not) can call this endpoint. The
 * auth-gate table covers the unauthenticated → 401 case and the
 * "any logged-in user → reaches the success path" case.
 */

const mocks = vi.hoisted(() => {
  class TestGuardError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "GuardError";
    }
  }
  return {
    matchFindUnique: vi.fn(),
    competitionFindUnique: vi.fn(),
    competitionMatchDeleteMany: vi.fn(),
    getUser: vi.fn(),
    TestGuardError,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: vi.fn(async () => {
    const { data } = await mocks.getUser();
    if (!data?.user) {
      throw new mocks.TestGuardError(401, "NOT_AUTHENTICATED");
    }
    return { id: data.user.id, email: data.user.email ?? "" };
  }),
  GuardError: mocks.TestGuardError,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    match: {
      findUnique: (...args: unknown[]) => mocks.matchFindUnique(...args),
    },
    competition: {
      findUnique: (...args: unknown[]) => mocks.competitionFindUnique(...args),
    },
    competitionMatch: {
      deleteMany: (...args: unknown[]) => mocks.competitionMatchDeleteMany(...args),
    },
  },
}));

import { DELETE } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});

function makeReq(): Request {
  return new Request("http://localhost", { method: "DELETE" });
}

// `params` matches the route's signature: a Promise of `{ id, matchId }`.
function makeParams(id: string, matchId: string) {
  return { params: Promise.resolve({ id, matchId }) };
}

describe("DELETE /api/v1/admin/competitions/[id]/matches/[matchId]", () => {
  // 1. AUTH + ID GATES
  describe("auth + missing id (table-driven)", () => {
    const futureKickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const cases: Array<{
      name: string;
      user: { id: string; email?: string } | null;
      id: string;
      matchId: string;
      expectedStatus: number;
      expectDeleteManyCalled: boolean;
    }> = [
      { name: "401 when not authenticated", user: null, id: "c1", matchId: "m1", expectedStatus: 401, expectDeleteManyCalled: false },
      { name: "400 when competition id is empty", user: { id: "u1" }, id: "", matchId: "m1", expectedStatus: 400, expectDeleteManyCalled: false },
      { name: "400 when matchId is empty", user: { id: "u1" }, id: "c1", matchId: "", expectedStatus: 400, expectDeleteManyCalled: false },
      // NEW: the manage-matches-public round opened this endpoint
      // to all logged-in users. These cases verify that non-admin
      // users reach the success path (the match-lookup + delete
      // path; the auth gate does not block them).
      {
        name: "200 for a non-admin authenticated user who IS in the editors list",
        user: { id: "u-regular", email: "user@example.com" },
        id: "c1",
        matchId: "m1",
        expectedStatus: 200,
        expectDeleteManyCalled: true,
      },
      {
        name: "200 for an admin authenticated user who IS in the editors list",
        user: { id: "u-admin", email: "admin@example.com" },
        id: "c1",
        matchId: "m1",
        expectedStatus: 200,
        expectDeleteManyCalled: true,
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: c.user } });
        if (c.expectDeleteManyCalled) {
          // The editor check now reads `Competition.details.editors`.
          // We pass the caller's id in the editors list so the check
          // passes — the auth-gate table verifies the auth check, not
          // the editor check (the editor check has its own table).
          mocks.competitionFindUnique.mockResolvedValue({
            id: "c1",
            deletedAt: null,
            details: { editors: c.user ? [c.user.id] : [] },
          });
          mocks.matchFindUnique.mockResolvedValue({
            id: "m1",
            kickoffTime: futureKickoff,
            status: "SCHEDULED",
          });
          mocks.competitionMatchDeleteMany.mockResolvedValue({ count: 1 });
        }
        const res = await DELETE(makeReq(), makeParams(c.id, c.matchId));
        expect(res.status).toBe(c.expectedStatus);
        if (c.expectDeleteManyCalled) {
          expect(mocks.competitionMatchDeleteMany).toHaveBeenCalled();
        } else {
          expect(mocks.competitionMatchDeleteMany).not.toHaveBeenCalled();
        }
      });
    }
  });

  // 2. MATCH NOT FOUND
  it("returns 404 when the match does not exist", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      details: { editors: ["u1"] },
    });
    mocks.matchFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeReq(), makeParams("c1", "m-missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("MATCH_NOT_FOUND");
    expect(mocks.competitionMatchDeleteMany).not.toHaveBeenCalled();
  });

  // 3. ALREADY-PLAYED GATE
  describe("MATCH_ALREADY_PLAYED gate (table-driven)", () => {
    const futureKickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pastKickoff = new Date(Date.now() - 60 * 1000);
    const cases: Array<{
      name: string;
      match: { id: string; kickoffTime: Date; status: "SCHEDULED" | "GOING" | "FINISHED" };
      expectStatus: number;
    }> = [
      {
        name: "rejects when kickoffTime has passed (status SCHEDULED, in-flight)",
        match: { id: "m1", kickoffTime: pastKickoff, status: "SCHEDULED" },
        expectStatus: 400,
      },
      {
        name: "rejects when status is FINISHED (regardless of kickoffTime)",
        match: { id: "m1", kickoffTime: futureKickoff, status: "FINISHED" },
        expectStatus: 400,
      },
      {
        name: "rejects when both kickoffTime has passed AND status is FINISHED",
        match: { id: "m1", kickoffTime: pastKickoff, status: "FINISHED" },
        expectStatus: 400,
      },
      {
        name: "allows when kickoffTime is in the future AND status is SCHEDULED",
        match: { id: "m1", kickoffTime: futureKickoff, status: "SCHEDULED" },
        expectStatus: 200,
      },
      {
        name: "allows when kickoffTime is in the future AND status is GOING (in-flight but not yet played)",
        match: { id: "m1", kickoffTime: futureKickoff, status: "GOING" },
        expectStatus: 200,
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
        mocks.competitionFindUnique.mockResolvedValue({
          id: "c1",
          deletedAt: null,
          details: { editors: ["u1"] },
        });
        mocks.matchFindUnique.mockResolvedValue(c.match);
        mocks.competitionMatchDeleteMany.mockResolvedValue({ count: 1 });
        const res = await DELETE(makeReq(), makeParams("c1", "m1"));
        expect(res.status).toBe(c.expectStatus);
        if (c.expectStatus === 400) {
          const body = await res.json();
          expect(body.error).toBe("MATCH_ALREADY_PLAYED");
          expect(mocks.competitionMatchDeleteMany).not.toHaveBeenCalled();
        } else {
          expect(mocks.competitionMatchDeleteMany).toHaveBeenCalled();
        }
      });
    }
  });

  // 4. SUCCESS PATH
  it("deletes the CompetitionMatch row by composite key (matchId, competitionId)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      details: { editors: ["u1"] },
    });
    mocks.matchFindUnique.mockResolvedValue({
      id: "m1",
      kickoffTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "SCHEDULED",
    });
    mocks.competitionMatchDeleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(makeReq(), makeParams("c1", "m1"));
    expect(res.status).toBe(200);
    expect(mocks.competitionMatchDeleteMany).toHaveBeenCalledWith({
      where: { matchId: "m1", competitionId: "c1" },
    });
    const body = await res.json();
    expect(body).toEqual({ removed: true });
  });

  // 5. IDEMPOTENCY
  it("is idempotent: returns 200 with `removed: false` when the row is already gone", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      details: { editors: ["u1"] },
    });
    mocks.matchFindUnique.mockResolvedValue({
      id: "m1",
      kickoffTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "SCHEDULED",
    });
    // Second DELETE on the same pair → deleteMany count = 0.
    mocks.competitionMatchDeleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(makeReq(), makeParams("c1", "m1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ removed: false });
  });

  // 6. EDITOR CHECK (creator-only edit on custom tournaments)
  describe("editor check (table-driven)", () => {
    // Same rule as the POST endpoint: the caller must be in
    // `Competition.details.editors`. The check is run BEFORE the
    // match-existence lookup so a non-editor can't probe whether
    // a match is in the system.
    const futureKickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const cases: Array<{
      name: string;
      userId: string;
      editors: string[] | undefined;
      expectStatus: number;
      expectDeleteManyCalled: boolean;
    }> = [
      {
        name: "200 when the caller is in the editors list",
        userId: "u1",
        editors: ["u1"],
        expectStatus: 200,
        expectDeleteManyCalled: true,
      },
      {
        name: "403 NOT_EDITOR when the caller is NOT in the editors list",
        userId: "u1",
        editors: ["u2"],
        expectStatus: 403,
        expectDeleteManyCalled: false,
      },
      {
        name: "403 NOT_EDITOR when the editors list is empty",
        userId: "u1",
        editors: [],
        expectStatus: 403,
        expectDeleteManyCalled: false,
      },
      {
        name: "403 NOT_EDITOR when the editors field is missing (legacy tournament)",
        userId: "u1",
        editors: undefined,
        expectStatus: 403,
        expectDeleteManyCalled: false,
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: { id: c.userId } } });
        mocks.competitionFindUnique.mockResolvedValue({
          id: "c1",
          deletedAt: null,
          details:
            c.editors === undefined ? null : { editors: c.editors },
        });
        if (c.expectDeleteManyCalled) {
          mocks.matchFindUnique.mockResolvedValue({
            id: "m1",
            kickoffTime: futureKickoff,
            status: "SCHEDULED",
          });
          mocks.competitionMatchDeleteMany.mockResolvedValue({ count: 1 });
        }
        const res = await DELETE(makeReq(), makeParams("c1", "m1"));
        expect(res.status).toBe(c.expectStatus);
        if (c.expectStatus === 403) {
          const body = await res.json();
          expect(body.error).toBe("NOT_EDITOR");
        }
        if (c.expectDeleteManyCalled) {
          expect(mocks.competitionMatchDeleteMany).toHaveBeenCalled();
        } else {
          expect(mocks.competitionMatchDeleteMany).not.toHaveBeenCalled();
        }
      });
    }
  });

  it("returns 404 when the competition does not exist (no editor check fires)", async () => {
    // The 404 (missing competition) gate runs BEFORE the editor
    // check — same order as the POST endpoint. The check is
    // skipped entirely on a missing competition.
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeReq(), makeParams("c-missing", "m1"));
    expect(res.status).toBe(404);
    expect(mocks.matchFindUnique).not.toHaveBeenCalled();
    expect(mocks.competitionMatchDeleteMany).not.toHaveBeenCalled();
  });
});
