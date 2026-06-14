import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for `POST /api/v1/admin/competitions` — the create-custom-
 * tournament endpoint. The route:
 *   - gates on requireAdmin (401 if unauthenticated, 403 if not admin)
 *   - validates the body with CreateCustomCompetitionInput
 *   - creates a Competition with externalSource = null so the cron
 *     never auto-syncs it
 *   - maps a unique-constraint violation (Prisma P2002) to a clean
 *     400 with `error: "NAME_TAKEN"`
 *
 * Table-driven coverage for the validation / auth / success path
 * (mirrors the style of `app/api/v1/admin/competitions/[id]/route.test.ts`).
 *
 * The "manage-matches-public" round opened the add/remove matches
 * endpoints to all logged-in users, but creating a custom
 * tournament stays admin-only. The auth-gate table here proves a
 * non-admin authenticated user is still rejected.
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
  // Prisma client error class — we instantiate it from the test body
  // to simulate P2002 (unique-constraint) failures.
  class TestPrismaError extends Error {
    code: string;
    constructor(code: string) {
      super(`Prisma error ${code}`);
      this.code = code;
      this.name = "PrismaClientKnownRequestError";
    }
  }
  return {
    competitionCreate: vi.fn(),
    getUser: vi.fn(),
    userFindUnique: vi.fn(),
    TestGuardError,
    TestPrismaError,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  // Mirror the real `requireAdmin` shape: unauthenticated → 401,
  // authenticated but no User row → 403, authenticated non-admin →
  // 403 NOT_ADMIN, authenticated admin → ok.
  requireAdmin: vi.fn(async () => {
    const { data } = await mocks.getUser();
    if (!data?.user) {
      throw new mocks.TestGuardError(401, "NOT_AUTHENTICATED");
    }
    const dbUser = await mocks.userFindUnique({
      where: { id: data.user.id },
    });
    if (!dbUser) {
      throw new mocks.TestGuardError(403, "USER_NOT_FOUND");
    }
    if (!dbUser.isAdmin) {
      throw new mocks.TestGuardError(403, "NOT_ADMIN");
    }
    return { id: dbUser.id, email: dbUser.email };
  }),
  GuardError: mocks.TestGuardError,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    competition: {
      create: (...args: unknown[]) => mocks.competitionCreate(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mocks.userFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/generated/prisma/client", () => ({
  // The route's try/catch checks `instanceof Prisma.PrismaClientKnownRequestError`.
  // We expose a class with the same name and a `code` field.
  Prisma: {
    PrismaClientKnownRequestError: class {
      code: string;
      constructor(code: string) {
        this.code = code;
      }
    },
  },
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: not authenticated. Tests override per-case.
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  // Default: User row for an authenticated user is admin. The
  // non-admin and missing-user cases override per-test.
  mocks.userFindUnique.mockResolvedValue({
    id: "u1",
    email: "u1@example.com",
    isAdmin: true,
  });
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/v1/admin/competitions", () => {
  // 1. AUTH GATES
  describe("auth gates (table-driven)", () => {
    const cases: Array<{
      name: string;
      user: { id: string } | null;
      dbUser: { id: string; email: string; isAdmin: boolean } | null;
      expectedStatus: number;
      expectCreateCalled: boolean;
    }> = [
      {
        name: "401 when not authenticated",
        user: null,
        dbUser: null,
        expectedStatus: 401,
        expectCreateCalled: false,
      },
      {
        name: "201 when authenticated as admin",
        user: { id: "u1" },
        dbUser: { id: "u1", email: "u1@example.com", isAdmin: true },
        expectedStatus: 201,
        expectCreateCalled: true,
      },
      // The create endpoint stays admin-only after the
      // "manage-matches-public" round — only the add/remove match
      // endpoints opened up. A non-admin authenticated user must
      // still get 403.
      {
        name: "403 NOT_ADMIN when authenticated as a non-admin user",
        user: { id: "u-regular" },
        dbUser: { id: "u-regular", email: "user@example.com", isAdmin: false },
        expectedStatus: 403,
        expectCreateCalled: false,
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: c.user } });
        if (c.dbUser) {
          mocks.userFindUnique.mockResolvedValue(c.dbUser);
        } else {
          mocks.userFindUnique.mockResolvedValue(null);
        }
        if (c.expectCreateCalled) {
          mocks.competitionCreate.mockResolvedValue({
            id: "c-new",
            name: "My Custom Cup",
            externalSource: null,
          });
        }
        const res = await POST(
          makeReq({
            name: "My Custom Cup",
            endDate: "2026-12-31T23:59:59Z",
          }),
        );
        expect(res.status).toBe(c.expectedStatus);
        if (c.expectCreateCalled) {
          expect(mocks.competitionCreate).toHaveBeenCalledOnce();
        } else {
          expect(mocks.competitionCreate).not.toHaveBeenCalled();
        }
        if (c.expectedStatus === 403) {
          const body = await res.json();
          expect(body.error).toBe("NOT_ADMIN");
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
      { name: "rejects empty name", body: { name: "" }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects missing name", body: {}, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects name > 120 chars", body: { name: "x".repeat(121) }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects non-ISO endDate", body: { name: "X", endDate: "not-a-date" }, expectStatus: 400, expectErrorCode: "VALIDATION" },
      { name: "rejects invalid JSON", body: "not json", expectStatus: 400, expectErrorCode: "INVALID_JSON" },
      // The next cases exercise the new endDate-required rule
      // (mirror of the DB CHECK constraint `endDate_required_for_custom`
      // in prisma/init.sql). The Zod schema makes endDate required, and
      // the route returns a clean ENDDATE_REQUIRED code (not the generic
      // VALIDATION with a Zod "Required" message) for the missing-field
      // case. Vendor tournaments are not created via this endpoint, so
      // the CHECK constraint is never reachable here. Note: a
      // *present-but-malformed* endDate (e.g. "" or "not-a-date")
      // surfaces as VALIDATION — the field is there, it just isn't a
      // valid ISO 8601 string, and we let the generic error format
      // carry the message.
      {
        name: "returns 400 ENDDATE_REQUIRED when endDate is missing",
        body: { name: "X" },
        expectStatus: 400,
        expectErrorCode: "ENDDATE_REQUIRED",
      },
      {
        name: "returns 400 ENDDATE_REQUIRED when endDate is null",
        body: { name: "X", endDate: null },
        expectStatus: 400,
        expectErrorCode: "ENDDATE_REQUIRED",
      },
      {
        name: "returns 400 VALIDATION when endDate is empty string (present but malformed)",
        body: { name: "X", endDate: "" },
        expectStatus: 400,
        expectErrorCode: "VALIDATION",
      },
      {
        name: "accepts name + endDate",
        body: { name: "X", endDate: "2026-12-31T23:59:59Z" },
        expectStatus: 201,
      },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
        if (c.expectStatus === 201) {
          mocks.competitionCreate.mockResolvedValue({
            id: "c-new",
            name: "X",
            externalSource: null,
            externalLeagueId: null,
            externalSeason: null,
          });
        }
        const res = await POST(makeReq(c.body));
        expect(res.status).toBe(c.expectStatus);
        if (c.expectErrorCode) {
          const body = await res.json();
          expect(body.error).toBe(c.expectErrorCode);
        }
        if (c.expectStatus === 201) {
          expect(mocks.competitionCreate).toHaveBeenCalledOnce();
        } else {
          expect(mocks.competitionCreate).not.toHaveBeenCalled();
        }
      });
    }
  });

  // 3. SUCCESS PATH — invariants
  it("creates a competition with externalSource = null and externalLeagueId = null (no vendor linkage)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "My Custom Cup",
      externalSource: null,
    });
    await POST(
      makeReq({
        name: "My Custom Cup",
        endDate: "2026-12-31T23:59:59Z",
      }),
    );
    const callArg = mocks.competitionCreate.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    // The new shape includes the `details` field for the editor
    // check; the rest of the vendor-linkage + endDate invariants
    // are unchanged from the pre-creator-only-edit round.
    expect(callArg.data.name).toBe("My Custom Cup");
    expect(callArg.data.externalSource).toBe(null);
    expect(callArg.data.externalLeagueId).toBe(null);
    expect(callArg.data.externalSeason).toBe(null);
    expect(callArg.data.endDate).toBeInstanceOf(Date);
    expect(callArg.data.details).toEqual({
      createdBy: "u1",
      editors: ["u1"],
    });
  });

  it("converts endDate ISO string → Date object", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "X",
      endDate: new Date("2026-12-31T23:59:59Z"),
    });
    await POST(
      makeReq({ name: "X", endDate: "2026-12-31T23:59:59Z" }),
    );
    const callArg = mocks.competitionCreate.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(callArg.data.endDate).toBeInstanceOf(Date);
  });

  it("always includes endDate in the create payload (the field is required)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "X",
    });
    await POST(
      makeReq({ name: "X", endDate: "2026-12-31T23:59:59Z" }),
    );
    const callArg = mocks.competitionCreate.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect("endDate" in callArg.data).toBe(true);
    expect(callArg.data.endDate).toBeInstanceOf(Date);
  });

  // 3b. CREATOR + EDITORS TRACKING (creator-only edit round)
  // The new custom tournament stores the admin's id in
  // `details.createdBy` and seeds the `editors` list with that
  // same id. The manage-matches routes read `editors` to enforce
  // creator-only edit. The `createdBy` field is the human-readable
  // audit trail and is also used for rename permission.
  it("sets details.createdBy to the calling admin's id", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-admin-7" } } });
    // The requireAdmin mock reads the user id from userFindUnique,
    // not getUser — we override both so the admin's id flows
    // through the call.
    mocks.userFindUnique.mockResolvedValue({
      id: "u-admin-7",
      email: "u7@example.com",
      isAdmin: true,
    });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "X",
      externalSource: null,
    });
    await POST(
      makeReq({ name: "X", endDate: "2026-12-31T23:59:59Z" }),
    );
    const callArg = mocks.competitionCreate.mock.calls[0][0] as {
      data: { details: { createdBy: string; editors: string[] } };
    };
    expect(callArg.data.details.createdBy).toBe("u-admin-7");
  });

  it("seeds details.editors with the calling admin's id (the creator is the only editor)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-admin-7" } } });
    mocks.userFindUnique.mockResolvedValue({
      id: "u-admin-7",
      email: "u7@example.com",
      isAdmin: true,
    });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "X",
      externalSource: null,
    });
    await POST(
      makeReq({ name: "X", endDate: "2026-12-31T23:59:59Z" }),
    );
    const callArg = mocks.competitionCreate.mock.calls[0][0] as {
      data: { details: { editors: string[] } };
    };
    expect(callArg.data.details.editors).toEqual(["u-admin-7"]);
  });

  it("uses the caller's id (not a hardcoded value) for the editors seed", async () => {
    // A different admin → different editors list. Catches the
    // regression where a dev might hardcode "admin" or some
    // placeholder in the editors seed.
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-other-admin" } } });
    mocks.userFindUnique.mockResolvedValue({
      id: "u-other-admin",
      email: "uother@example.com",
      isAdmin: true,
    });
    mocks.competitionCreate.mockResolvedValue({
      id: "c-new",
      name: "X",
      externalSource: null,
    });
    await POST(
      makeReq({ name: "X", endDate: "2026-12-31T23:59:59Z" }),
    );
    const callArg = mocks.competitionCreate.mock.calls[0][0] as {
      data: { details: { createdBy: string; editors: string[] } };
    };
    expect(callArg.data.details.createdBy).toBe("u-other-admin");
    expect(callArg.data.details.editors).toEqual(["u-other-admin"]);
  });

  it("returns 201 with the created competition body", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const created = {
      id: "c-new",
      name: "My Custom Cup",
      externalSource: null,
      externalLeagueId: null,
      externalSeason: null,
      endDate: new Date("2026-12-31T23:59:59Z"),
    };
    mocks.competitionCreate.mockResolvedValue(created);
    const res = await POST(
      makeReq({
        name: "My Custom Cup",
        endDate: "2026-12-31T23:59:59Z",
      }),
    );
    expect(res.status).toBe(201);
    // res.json() serializes Date → ISO string, so compare against the
    // stringified expected value. The shape and value of the response
    // body is what matters here.
    const body = await res.json();
    expect(body).toEqual({
      ...created,
      endDate: "2026-12-31T23:59:59.000Z",
    });
  });

  // 4. UNIQUE-NAME HANDLING
  it("maps Prisma P2002 (unique name) to 400 NAME_TAKEN", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    // The route's catch checks `instanceof Prisma.PrismaClientKnownRequestError`.
    // Our mock class is named "PrismaClientKnownRequestError" by the
    // generated-client mock above, so this is the right shape.
    const { Prisma } = await import("@/lib/generated/prisma/client");
    const p2002 = new (Prisma.PrismaClientKnownRequestError as unknown as new (
      code: string,
    ) => Error & { code: string })("P2002");
    (p2002 as { code: string }).code = "P2002";
    mocks.competitionCreate.mockRejectedValue(p2002);
    const res = await POST(
      makeReq({ name: "Duplicate", endDate: "2026-12-31T23:59:59Z" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("NAME_TAKEN");
  });
});
