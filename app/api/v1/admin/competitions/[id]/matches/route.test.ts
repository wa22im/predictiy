import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for `POST /api/v1/admin/competitions/[id]/matches` — the
 * add-matches-to-custom-tournament endpoint. The route:
 *   - gates on requireAuth (401) — open to all logged-in users
 *   - validates the body with AddMatchesInput
 *   - verifies the competition exists (and is not soft-deleted)
 *   - verifies every matchId exists (404 on any bogus id)
 *   - createMany with skipDuplicates; returns `{ added, requested }`
 *
 * Auth model: as of the "manage-matches-public" round, any
 * authenticated user (admin or not) can call this endpoint. The
 * test mocks requireAuth at the module boundary and asserts the
 * unauthenticated → 401 case; success-path tests pass an arbitrary
 * user id to simulate "any logged-in user".
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
    competitionFindUnique: vi.fn(),
    matchFindMany: vi.fn(),
    competitionMatchCreateMany: vi.fn(),
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
    competition: {
      findUnique: (...args: unknown[]) => mocks.competitionFindUnique(...args),
    },
    match: {
      findMany: (...args: unknown[]) => mocks.matchFindMany(...args),
    },
    competitionMatch: {
      createMany: (...args: unknown[]) => mocks.competitionMatchCreateMany(...args),
    },
  },
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "c1" }) };

describe("POST /api/v1/admin/competitions/[id]/matches", () => {
  // 1. AUTH + ID GATES
  describe("auth + missing id (table-driven)", () => {
    const cases: Array<{
      name: string;
      user: { id: string; email?: string } | null;
      id: string;
      expectedStatus: number;
      expectCreateManyCalled: boolean;
    }> = [
      { name: "401 when not authenticated", user: null, id: "c1", expectedStatus: 401, expectCreateManyCalled: false },
      { name: "400 when competition id is empty", user: { id: "u1" }, id: "", expectedStatus: 400, expectCreateManyCalled: false },
      // NEW: the manage-matches-public round opened this endpoint
      // to all logged-in users. These cases verify that non-admin
      // users (no special role flag) are accepted.
      { name: "200 for a non-admin authenticated user who IS in the editors list", user: { id: "u-regular", email: "user@example.com" }, id: "c1", expectedStatus: 200, expectCreateManyCalled: true },
      { name: "200 for an admin authenticated user who IS in the editors list", user: { id: "u-admin", email: "admin@example.com" }, id: "c1", expectedStatus: 200, expectCreateManyCalled: true },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: c.user } });
        if (c.expectCreateManyCalled) {
          mocks.competitionFindUnique.mockResolvedValue({
            id: "c1",
            deletedAt: null,
            endDate: null,
            // editors contains the caller — the editor check passes.
            details: { editors: [c.user!.id] },
          });
          // The route now reads `kickoffTime` + `status` from the
          // match row to enforce the 1-hour buffer + endDate gates.
          // We supply a kickoff 2h in the future so the buffer
          // check passes.
          mocks.matchFindMany.mockResolvedValue([
            {
              id: "m1",
              kickoffTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
              status: "SCHEDULED",
            },
          ]);
          mocks.competitionMatchCreateMany.mockResolvedValue({ count: 1 });
        }
        const res = await POST(makeReq({ matchIds: ["m1"] }), {
          params: Promise.resolve({ id: c.id }),
        });
        expect(res.status).toBe(c.expectedStatus);
        if (c.expectCreateManyCalled) {
          expect(mocks.competitionMatchCreateMany).toHaveBeenCalled();
        } else {
          expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
        }
      });
    }
  });

  // 2. INPUT VALIDATION
  describe("input validation (table-driven)", () => {
    const cases: Array<{
      name: string;
      body: unknown;
      expectStatus: number;
      expectErrorCode?: string;
    }> = [
      { name: "rejects empty matchIds array", body: { matchIds: [] }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects missing matchIds", body: {}, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects empty-string matchId", body: { matchIds: [""] }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects > 100 matchIds", body: { matchIds: Array.from({ length: 101 }, (_, i) => `m${i}`) }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects invalid JSON", body: "not json", expectStatus: 400, expectErrorCode: "INVALID_JSON" },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
        const res = await POST(makeReq(c.body), params);
        expect(res.status).toBe(c.expectStatus);
        if (c.expectErrorCode) {
          const body = await res.json();
          expect(body.error).toBe(c.expectErrorCode);
        }
        expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
      });
    }
  });

  // 3. COMPETITION LOOKUP
  it("returns 404 when competition does not exist", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ matchIds: ["m1"] }), params);
    expect(res.status).toBe(404);
    expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when competition is soft-deleted", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const res = await POST(makeReq({ matchIds: ["m1"] }), params);
    expect(res.status).toBe(404);
    expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
  });

  // 4. MATCH EXISTENCE CHECK
  it("returns 404 MATCH_NOT_FOUND when a matchId is bogus", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      endDate: null,
      details: { editors: ["u1"] },
    });
    // Only m1 exists; m2 is bogus.
    mocks.matchFindMany.mockResolvedValue([{ id: "m1" }]);
    const res = await POST(makeReq({ matchIds: ["m1", "m2"] }), params);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("MATCH_NOT_FOUND");
    expect(body.message).toContain("m2");
    expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
  });

  // 5. SUCCESS PATH
  it("creates a CompetitionMatch row for each matchId with skipDuplicates", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      endDate: null,
      details: { editors: ["u1"] },
    });
    mocks.matchFindMany.mockResolvedValue([
      { id: "m1", kickoffTime: new Date(Date.now() + 2 * 60 * 60 * 1000), status: "SCHEDULED" },
      { id: "m2", kickoffTime: new Date(Date.now() + 3 * 60 * 60 * 1000), status: "SCHEDULED" },
    ]);
    mocks.competitionMatchCreateMany.mockResolvedValue({ count: 2 });
    const res = await POST(makeReq({ matchIds: ["m1", "m2"] }), params);
    expect(res.status).toBe(200);
    expect(mocks.competitionMatchCreateMany).toHaveBeenCalledWith({
      data: [
        { matchId: "m1", competitionId: "c1" },
        { matchId: "m2", competitionId: "c1" },
      ],
      skipDuplicates: true,
    });
    const body = await res.json();
    expect(body).toEqual({ added: 2, requested: 2 });
  });

  it("dedupes repeated matchIds before the createMany call", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      endDate: null,
      details: { editors: ["u1"] },
    });
    mocks.matchFindMany.mockResolvedValue([
      { id: "m1", kickoffTime: new Date(Date.now() + 2 * 60 * 60 * 1000), status: "SCHEDULED" },
      { id: "m2", kickoffTime: new Date(Date.now() + 3 * 60 * 60 * 1000), status: "SCHEDULED" },
    ]);
    mocks.competitionMatchCreateMany.mockResolvedValue({ count: 2 });
    await POST(
      makeReq({ matchIds: ["m1", "m2", "m1", "m2"] }),
      params,
    );
    const callArg = mocks.competitionMatchCreateMany.mock.calls[0][0] as {
      data: unknown[];
    };
    expect(callArg.data).toHaveLength(2);
  });

  it("returns 200 with `added` reflecting the createMany count (duplicates are skipped silently)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      endDate: null,
      details: { editors: ["u1"] },
    });
    mocks.matchFindMany.mockResolvedValue([
      { id: "m1", kickoffTime: new Date(Date.now() + 2 * 60 * 60 * 1000), status: "SCHEDULED" },
      { id: "m2", kickoffTime: new Date(Date.now() + 3 * 60 * 60 * 1000), status: "SCHEDULED" },
      { id: "m3", kickoffTime: new Date(Date.now() + 4 * 60 * 60 * 1000), status: "SCHEDULED" },
    ]);
    // All 3 already linked → 0 newly inserted.
    mocks.competitionMatchCreateMany.mockResolvedValue({ count: 0 });
    const res = await POST(makeReq({ matchIds: ["m1", "m2", "m3"] }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ added: 0, requested: 3 });
  });

  // 6. EDITOR CHECK (creator-only edit on custom tournaments)
  describe("editor check (table-driven)", () => {
    // After the creator-only-edit round, the route enforces
    // `editors?.includes(caller.id)`. The premortem in the ISC
    // says: if `editors` is missing entirely, default to "no
    // access" — the check is `editors?.includes(caller.id) ?? false`.
    // Vendor tournaments (externalSource !== null) have a different
    // auth model (admin-only via the cron + create-competition path);
    // the editor check is custom-tournament-specific.
    const cases: Array<{
      name: string;
      userId: string;
      editors: string[] | undefined;
      expectStatus: number;
      expectCreateManyCalled: boolean;
    }> = [
      {
        name: "200 when the caller is in the editors list",
        userId: "u1",
        editors: ["u1"],
        expectStatus: 200,
        expectCreateManyCalled: true,
      },
      {
        name: "200 when the editors list contains the caller AND other users",
        userId: "u1",
        editors: ["u1", "u2", "u3"],
        expectStatus: 200,
        expectCreateManyCalled: true,
      },
      {
        name: "403 NOT_EDITOR when the caller is NOT in the editors list",
        userId: "u1",
        editors: ["u2"],
        expectStatus: 403,
        expectCreateManyCalled: false,
      },
      {
        name: "403 NOT_EDITOR when the editors list is empty",
        userId: "u1",
        editors: [],
        expectStatus: 403,
        expectCreateManyCalled: false,
      },
      {
        name: "403 NOT_EDITOR when the editors field is missing (legacy tournament)",
        userId: "u1",
        editors: undefined,
        expectStatus: 403,
        expectCreateManyCalled: false,
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: { id: c.userId } } });
        mocks.competitionFindUnique.mockResolvedValue({
          id: "c1",
          deletedAt: null,
          endDate: null,
          // The route reads `details?.editors?.includes(caller.id)`.
          // We pass `editors: undefined` for the missing-field case
          // to mirror a legacy tournament with no `details` set.
          details:
            c.editors === undefined
              ? null
              : { editors: c.editors },
        });
        if (c.expectCreateManyCalled) {
          mocks.matchFindMany.mockResolvedValue([
            {
              id: "m1",
              kickoffTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
              status: "SCHEDULED",
            },
          ]);
          mocks.competitionMatchCreateMany.mockResolvedValue({ count: 1 });
        }
        const res = await POST(makeReq({ matchIds: ["m1"] }), params);
        expect(res.status).toBe(c.expectStatus);
        if (c.expectStatus === 403) {
          const body = await res.json();
          expect(body.error).toBe("NOT_EDITOR");
        }
        if (c.expectCreateManyCalled) {
          expect(mocks.competitionMatchCreateMany).toHaveBeenCalled();
        } else {
          expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
        }
      });
    }
  });

  // 7. MATCH-VALIDATION GATES (1-hour buffer + endDate)
  describe("match validation: 1-hour buffer + endDate (table-driven)", () => {
    // The route rejects matchIds whose kickoffTime is within
    // MIN_HOURS_BEFORE_KICKOFF of `now`, OR whose kickoffTime is
    // after the competition's `endDate`. Both gates use the
    // shared constant from `lib/validation/tournament.ts`.
    const future = (ms: number) => new Date(Date.now() + ms);
    const cases: Array<{
      name: string;
      kickoffOffsetMs: number; // 0 = now, +X = X ms in the future
      competitionEndDate: Date | null;
      expectStatus: number;
      expectErrorCode?: string;
    }> = [
      {
        name: "400 MATCH_TOO_CLOSE when kickoff is 30 min from now (under the 1-hour buffer)",
        kickoffOffsetMs: 30 * 60 * 1000,
        competitionEndDate: future(7 * 24 * 60 * 60 * 1000),
        expectStatus: 400,
        expectErrorCode: "MATCH_TOO_CLOSE",
      },
      {
        name: "400 MATCH_TOO_CLOSE when kickoff is exactly 1 hour from now (the boundary is strict less-than)",
        kickoffOffsetMs: 60 * 60 * 1000,
        competitionEndDate: future(7 * 24 * 60 * 60 * 1000),
        expectStatus: 400,
        expectErrorCode: "MATCH_TOO_CLOSE",
      },
      {
        name: "400 MATCH_TOO_CLOSE when kickoff is in the past",
        kickoffOffsetMs: -5 * 60 * 1000,
        competitionEndDate: future(7 * 24 * 60 * 60 * 1000),
        expectStatus: 400,
        expectErrorCode: "MATCH_TOO_CLOSE",
      },
      {
        name: "200 when kickoff is 2 hours from now (safely past the buffer)",
        kickoffOffsetMs: 2 * 60 * 60 * 1000,
        competitionEndDate: future(7 * 24 * 60 * 60 * 1000),
        expectStatus: 200,
      },
      {
        name: "200 when kickoff is 7 days from now (long-future match)",
        kickoffOffsetMs: 7 * 24 * 60 * 60 * 1000,
        competitionEndDate: future(30 * 24 * 60 * 60 * 1000),
        expectStatus: 200,
      },
      {
        name: "400 MATCH_AFTER_ENDDATE when kickoff is past the competition's endDate",
        kickoffOffsetMs: 3 * 24 * 60 * 60 * 1000,
        competitionEndDate: future(2 * 24 * 60 * 60 * 1000), // 2 days < 3 days
        expectStatus: 400,
        expectErrorCode: "MATCH_AFTER_ENDDATE",
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
        mocks.competitionFindUnique.mockResolvedValue({
          id: "c1",
          deletedAt: null,
          endDate: c.competitionEndDate,
          details: { editors: ["u1"] },
        });
        // The route now loads `kickoffTime` + `status` per matchId
        // to enforce the 1-hour buffer + endDate rule. We always
        // return one match row whose kickoffTime matches the case.
        mocks.matchFindMany.mockResolvedValue([
          {
            id: "m1",
            kickoffTime: future(c.kickoffOffsetMs),
            status: "SCHEDULED",
          },
        ]);
        if (c.expectStatus === 200) {
          mocks.competitionMatchCreateMany.mockResolvedValue({ count: 1 });
        }
        const res = await POST(makeReq({ matchIds: ["m1"] }), params);
        expect(res.status).toBe(c.expectStatus);
        if (c.expectErrorCode) {
          const body = await res.json();
          expect(body.error).toBe(c.expectErrorCode);
          expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
        } else {
          expect(mocks.competitionMatchCreateMany).toHaveBeenCalled();
        }
      });
    }
  });

  it("rejects the WHOLE request when ANY matchId fails the 1-hour buffer (no partial inserts)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      deletedAt: null,
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      details: { editors: ["u1"] },
    });
    // m1 is 2h away (OK), m2 is 30 min away (TOO CLOSE).
    mocks.matchFindMany.mockResolvedValue([
      {
        id: "m1",
        kickoffTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: "SCHEDULED",
      },
      {
        id: "m2",
        kickoffTime: new Date(Date.now() + 30 * 60 * 1000),
        status: "SCHEDULED",
      },
    ]);
    const res = await POST(makeReq({ matchIds: ["m1", "m2"] }), params);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("MATCH_TOO_CLOSE");
    // NO insert is made when any match fails the gate. createMany
    // must not have been called.
    expect(mocks.competitionMatchCreateMany).not.toHaveBeenCalled();
  });
});
