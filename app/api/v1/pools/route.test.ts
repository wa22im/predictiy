import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for `POST /api/v1/pools` — the public Create Pool endpoint.
 *
 * The route is open to any logged-in user (admin or not). The body
 * accepts one of two shapes:
 *   1. { name, competitionId }              → bind pool to existing competition
 *   2. { name, newCompetition: { name, endDate } }
 *                                          → create a custom tournament
 *                                            inline, then bind the pool
 *                                            to it
 *
 * Validation rules (Zod):
 *   - `name` required, 1-80 chars
 *   - XOR(competitionId, newCompetition) — exactly one of the two
 *   - When newCompetition is set, `endDate` is required
 *
 * When `newCompetition` is provided, the new Competition row is
 * born with `externalSource = null` AND
 * `details = { createdBy: caller.id, editors: [caller.id] }` so
 * the creator is the only editor on the tournament (matches the
 * creator-only edit policy from the ISC).
 *
 * The pool is created with the caller as the first GroupMember
 * (`requireAuth()` already returned the user, so we trust the
 * caller.id from there). The pool's `Group.details.createdBy` is
 * also set so the rename-only-creator permission works downstream.
 *
 * Auth model: any logged-in user (admin or not). The
 * unauthenticated → 401 case is in the auth-gate table; the
 * "non-admin user can create a pool" case is exercised by the
 * success path tests.
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
    competitionCreate: vi.fn(),
    groupCreate: vi.fn(),
    groupFindUnique: vi.fn(),
    generateInviteCode: vi.fn(),
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
      create: (...args: unknown[]) => mocks.competitionCreate(...args),
    },
    group: {
      create: (...args: unknown[]) => mocks.groupCreate(...args),
      findUnique: (...args: unknown[]) => mocks.groupFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/invite", () => ({
  generateInviteCode: () => mocks.generateInviteCode(),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  // Default: invite code is unique on the first call (no collision).
  mocks.groupFindUnique.mockResolvedValue(null);
  mocks.generateInviteCode.mockReturnValue("INVITE12345");
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/v1/pools", () => {
  // 1. AUTH GATES
  describe("auth gates (table-driven)", () => {
    const cases: Array<{
      name: string;
      user: { id: string; email?: string } | null;
      body: unknown;
      expectedStatus: number;
      expectCreateCalled: boolean;
    }> = [
      // 401 — caller is not signed in. The body shape doesn't
      // matter; the auth check is the first gate.
      {
        name: "401 when not authenticated (body is a valid existing-competition shape)",
        user: null,
        body: { name: "Friday Crew", competitionId: "c-existing" },
        expectedStatus: 401,
        expectCreateCalled: false,
      },
      {
        name: "401 when not authenticated (body is a valid new-competition shape)",
        user: null,
        body: {
          name: "Friday Crew",
          newCompetition: { name: "Custom Cup", endDate: "2026-12-31T23:59:59Z" },
        },
        expectedStatus: 401,
        expectCreateCalled: false,
      },
      // 201 — non-admin authenticated user can create a pool.
      // This is the headline requirement of the public-create-pool
      // ISC: open the endpoint to all logged-in users.
      {
        name: "201 for a non-admin authenticated user (existing competition)",
        user: { id: "u-regular", email: "user@example.com" },
        body: { name: "Friday Crew", competitionId: "c-existing" },
        expectedStatus: 201,
        expectCreateCalled: true,
      },
      {
        name: "201 for an admin authenticated user (existing competition)",
        user: { id: "u-admin", email: "admin@example.com" },
        body: { name: "Friday Crew", competitionId: "c-existing" },
        expectedStatus: 201,
        expectCreateCalled: true,
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: c.user } });
        if (c.expectCreateCalled) {
          mocks.groupCreate.mockResolvedValue({
            id: "g1",
            name: "Friday Crew",
            competitionId: "c-existing",
          });
        }
        const res = await POST(makeReq(c.body));
        expect(res.status).toBe(c.expectedStatus);
        if (c.expectCreateCalled) {
          expect(mocks.groupCreate).toHaveBeenCalled();
        } else {
          expect(mocks.groupCreate).not.toHaveBeenCalled();
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
      // name rules
      { name: "rejects missing name", body: { competitionId: "c1" }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects empty name", body: { name: "", competitionId: "c1" }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects name > 80 chars", body: { name: "x".repeat(81), competitionId: "c1" }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      // XOR
      {
        name: "rejects when neither competitionId nor newCompetition is set",
        body: { name: "X" },
        expectStatus: 400,
        expectErrorCode: "VALIDATION",
      },
      {
        name: "rejects when BOTH competitionId and newCompetition are set",
        body: {
          name: "X",
          competitionId: "c-existing",
          newCompetition: { name: "Custom", endDate: "2026-12-31T23:59:59Z" },
        },
        expectStatus: 400,
        expectErrorCode: "VALIDATION",
      },
      // newCompetition rules
      {
        name: "rejects when newCompetition.name is empty",
        body: {
          name: "X",
          newCompetition: { name: "", endDate: "2026-12-31T23:59:59Z" },
        },
        expectStatus: 400,
        expectErrorCode: "VALIDATION",
      },
      {
        name: "rejects when newCompetition.name is missing",
        body: {
          name: "X",
          newCompetition: { endDate: "2026-12-31T23:59:59Z" },
        },
        expectStatus: 400,
        expectErrorCode: "VALIDATION",
      },
      {
        name: "rejects when newCompetition.endDate is missing",
        body: {
          name: "X",
          newCompetition: { name: "Custom" },
        },
        expectStatus: 400,
        expectErrorCode: "VALIDATION",
      },
      {
        name: "rejects when newCompetition.endDate is malformed",
        body: {
          name: "X",
          newCompetition: { name: "Custom", endDate: "not-a-date" },
        },
        expectStatus: 400,
        expectErrorCode: "VALIDATION",
      },
      { name: "rejects invalid JSON", body: "not json", expectStatus: 400, expectErrorCode: "INVALID_JSON" },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
        const res = await POST(makeReq(c.body));
        expect(res.status).toBe(c.expectStatus);
        if (c.expectErrorCode) {
          const body = await res.json();
          expect(body.error).toBe(c.expectErrorCode);
        }
        expect(mocks.competitionCreate).not.toHaveBeenCalled();
        expect(mocks.groupCreate).not.toHaveBeenCalled();
      });
    }
  });

  // 3. EXISTING-COMPETITION PATH
  it("creates a Group tied to an existing competition, with the caller as the first member", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.groupCreate.mockResolvedValue({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-existing",
    });
    const res = await POST(
      makeReq({ name: "Friday Crew", competitionId: "c-existing" }),
    );
    expect(res.status).toBe(201);
    // We MUST NOT create a new competition on the existing path.
    expect(mocks.competitionCreate).not.toHaveBeenCalled();
    // The group create payload must include:
    //   - the user-supplied name
    //   - the user-supplied competitionId
    //   - the caller as the first member (GroupMember.create.userId)
    //   - a `details.createdBy` field for downstream rename permission
    expect(mocks.groupCreate).toHaveBeenCalledWith({
      data: {
        name: "Friday Crew",
        competitionId: "c-existing",
        inviteCode: "INVITE12345",
        scoringConfig: expect.anything(),
        details: { createdBy: "u1" },
        members: {
          create: { userId: "u1" },
        },
      },
    });
  });

  it("returns 201 with the new group's id, name, competitionId, and competitionName", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.groupCreate.mockResolvedValue({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-existing",
    });
    const res = await POST(
      makeReq({ name: "Friday Crew", competitionId: "c-existing" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-existing",
      competitionName: undefined,
    });
  });

  // 4. NEW-COMPETITION PATH — INLINE CREATE
  it("with newCompetition: creates the Competition with externalSource=null and the Group in one call", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-creator" } } });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "My Custom Cup",
      endDate: new Date("2026-12-31T23:59:59Z"),
      externalSource: null,
    });
    mocks.groupCreate.mockResolvedValue({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-new",
    });
    const res = await POST(
      makeReq({
        name: "Friday Crew",
        newCompetition: {
          name: "My Custom Cup",
          endDate: "2026-12-31T23:59:59Z",
        },
      }),
    );
    expect(res.status).toBe(201);
    // Competition row was created with externalSource=null (so the
    // cron never auto-syncs it), and the typed endDate Date.
    expect(mocks.competitionCreate).toHaveBeenCalledWith({
      data: {
        name: "My Custom Cup",
        externalSource: null,
        externalLeagueId: null,
        externalSeason: null,
        endDate: expect.any(Date),
        // The details field carries the creator+editors list.
        // See the next test for the exact-shape assertion.
        details: expect.objectContaining({
          createdBy: "u-creator",
          editors: ["u-creator"],
        }),
      },
    });
    // The pool's competitionId is the NEWLY CREATED competition's id,
    // NOT a user-supplied id. The user only supplied the name +
    // endDate of the new tournament.
    expect(mocks.groupCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Friday Crew",
        competitionId: "c-new",
        members: { create: { userId: "u-creator" } },
        details: { createdBy: "u-creator" },
      }),
    });
  });

  it("with newCompetition: sets createdBy and editors on Competition.details", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-creator" } } });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "My Custom Cup",
      externalSource: null,
    });
    mocks.groupCreate.mockResolvedValue({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-new",
    });
    await POST(
      makeReq({
        name: "Friday Crew",
        newCompetition: {
          name: "My Custom Cup",
          endDate: "2026-12-31T23:59:59Z",
        },
      }),
    );
    const callArg = mocks.competitionCreate.mock.calls[0][0] as {
      data: { details: { createdBy: string; editors: string[] } };
    };
    expect(callArg.data.details.createdBy).toBe("u-creator");
    expect(callArg.data.details.editors).toEqual(["u-creator"]);
  });

  it("with newCompetition: the new pool is created with the caller as the first GroupMember", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-creator" } } });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "X",
      externalSource: null,
    });
    mocks.groupCreate.mockResolvedValue({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-new",
    });
    await POST(
      makeReq({
        name: "Friday Crew",
        newCompetition: { name: "X", endDate: "2026-12-31T23:59:59Z" },
      }),
    );
    const callArg = mocks.groupCreate.mock.calls[0][0] as {
      data: { members: { create: { userId: string } } };
    };
    expect(callArg.data.members.create.userId).toBe("u-creator");
  });

  it("with newCompetition: returns 201 with the new group's id + the new competition's id and name", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-creator" } } });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "My Custom Cup",
      externalSource: null,
    });
    mocks.groupCreate.mockResolvedValue({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-new",
    });
    const res = await POST(
      makeReq({
        name: "Friday Crew",
        newCompetition: {
          name: "My Custom Cup",
          endDate: "2026-12-31T23:59:59Z",
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      id: "g1",
      name: "Friday Crew",
      competitionId: "c-new",
      competitionName: "My Custom Cup",
    });
  });

  // 5. INVITE-CODE GENERATION
  it("retries invite-code generation on collision (up to 5 attempts)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    // First call to group.findUnique (for the invite code) returns
    // a collision; subsequent calls return null. This forces one
    // generateInviteCode retry.
    mocks.groupFindUnique
      .mockResolvedValueOnce({ id: "g-collide" })
      .mockResolvedValue(null);
    let call = 0;
    mocks.generateInviteCode.mockImplementation(() => {
      call += 1;
      return call === 1 ? "COLLIDE" : "FRESH1";
    });
    mocks.groupCreate.mockResolvedValue({
      id: "g1",
      name: "X",
      competitionId: "c1",
    });
    await POST(makeReq({ name: "X", competitionId: "c1" }));
    // The final inviteCode in the create payload is the second one.
    const callArg = mocks.groupCreate.mock.calls[0][0] as {
      data: { inviteCode: string };
    };
    expect(callArg.data.inviteCode).toBe("FRESH1");
  });
});
