import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted mock state. The shared shape lets the factory closures
// below and the test bodies reference the same vi.fn() instances
// after vitest's vi.mock hoisting.
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
    competitionUpdate: vi.fn(),
    getUser: vi.fn(),
    TestGuardError,
  };
});

vi.mock("server-only", () => ({}));

// We mock the guard directly so the test isn't coupled to the
// implementation of `requireAdmin`. The route's behavior under
// guard failures (401, etc.) is verified via the response status.
vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(async () => {
    const { data } = await mocks.getUser();
    if (!data?.user) {
      throw new mocks.TestGuardError(401, "NOT_AUTHENTICATED");
    }
    return { id: data.user.id, email: "" };
  }),
  GuardError: mocks.TestGuardError,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    competition: {
      findUnique: mocks.competitionFindUnique,
      update: mocks.competitionUpdate,
    },
  },
}));

import { PATCH, DELETE } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: not authenticated. Tests override per-case.
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  // Default: requireAdmin is a no-op (the test mocks it via
  // the vi.mock above). clearAllMocks wipes any prior
  // implementations, so re-establish the default after each test.
  // (The requireAdmin mock is recreated by the hoisted factory; we
  // do not need to re-set it here.)
});

describe("PATCH /api/v1/admin/competitions/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(401);
    expect(mocks.competitionUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for missing id", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test" }),
    });
    // params resolves to an empty object — id is undefined.
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid input (empty name)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ name: "" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION");
  });

  it("returns 400 for unknown fields (rejects deletedAt)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ deletedAt: "2026-01-01T00:00:00Z" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(400);
    // PATCH must NOT have called the DB — validation is the gate.
    expect(mocks.competitionUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: "not json",
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when competition not found", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue(null);
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates name and returns 200", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      name: "Old",
      deletedAt: null,
    });
    mocks.competitionUpdate.mockResolvedValue({
      id: "c1",
      name: "New",
      deletedAt: null,
    });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.competitionUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "New" },
    });
  });

  it("updates endDate (datetime string → Date object)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      name: "X",
      deletedAt: null,
      externalSource: "football-data",
    });
    mocks.competitionUpdate.mockResolvedValue({
      id: "c1",
      name: "X",
      endDate: new Date("2026-07-19T00:00:00Z"),
      deletedAt: null,
    });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ endDate: "2026-07-19T00:00:00Z" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.competitionUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { endDate: expect.any(Date) },
    });
  });

  it("clears endDate (null) and externalLeagueId (null)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      name: "X",
      deletedAt: null,
      externalSource: "football-data",
    });
    mocks.competitionUpdate.mockResolvedValue({
      id: "c1",
      name: "X",
      endDate: null,
      externalLeagueId: null,
      deletedAt: null,
    });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ endDate: null, externalLeagueId: null }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.competitionUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { endDate: null, externalLeagueId: null },
    });
  });

  describe("endDate immutability for custom tournaments (externalSource = null)", () => {
    it("returns 400 ENDDATE_IMMUTABLE when body includes a new endDate", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
      mocks.competitionFindUnique.mockResolvedValue({
        id: "c1",
        name: "Custom Cup",
        deletedAt: null,
        externalSource: null,
      });
      const req = new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ endDate: "2027-01-01T00:00:00Z" }),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: "c1" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("ENDDATE_IMMUTABLE");
      expect(mocks.competitionUpdate).not.toHaveBeenCalled();
    });

    it("returns 400 ENDDATE_IMMUTABLE when body includes endDate: null (clearing is also rejected)", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
      mocks.competitionFindUnique.mockResolvedValue({
        id: "c1",
        name: "Custom Cup",
        deletedAt: null,
        externalSource: null,
      });
      const req = new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ endDate: null }),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: "c1" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("ENDDATE_IMMUTABLE");
      expect(mocks.competitionUpdate).not.toHaveBeenCalled();
    });

    it("returns 200 when body does NOT include endDate (other fields still mutable)", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
      mocks.competitionFindUnique.mockResolvedValue({
        id: "c1",
        name: "Custom Cup",
        deletedAt: null,
        externalSource: null,
      });
      mocks.competitionUpdate.mockResolvedValue({
        id: "c1",
        name: "Renamed",
        deletedAt: null,
        externalSource: null,
      });
      const req = new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: "c1" }),
      });
      expect(res.status).toBe(200);
      expect(mocks.competitionUpdate).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { name: "Renamed" },
      });
    });

    it("returns 200 for a vendor tournament when body includes endDate (immutability does not apply)", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
      mocks.competitionFindUnique.mockResolvedValue({
        id: "c1",
        name: "Premier League",
        deletedAt: null,
        externalSource: "football-data",
      });
      mocks.competitionUpdate.mockResolvedValue({
        id: "c1",
        name: "Premier League",
        endDate: new Date("2027-01-01T00:00:00Z"),
        deletedAt: null,
        externalSource: "football-data",
      });
      const req = new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ endDate: "2027-01-01T00:00:00Z" }),
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ id: "c1" }),
      });
      expect(res.status).toBe(200);
      expect(mocks.competitionUpdate).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { endDate: expect.any(Date) },
      });
    });
  });

  it("updates details (free-form JSON)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      name: "X",
      deletedAt: null,
    });
    const details = { branding: { color: "red" }, notes: "hi" };
    mocks.competitionUpdate.mockResolvedValue({
      id: "c1",
      name: "X",
      details,
      deletedAt: null,
    });
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ details }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.competitionUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { details },
    });
  });
});

describe("DELETE /api/v1/admin/competitions/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const req = new Request("http://localhost", { method: "DELETE" });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(401);
    expect(mocks.competitionUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when competition not found", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue(null);
    const req = new Request("http://localhost", { method: "DELETE" });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(404);
  });

  it("sets deletedAt and returns 200", async () => {
    const now = new Date();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      name: "Test",
      deletedAt: null,
    });
    mocks.competitionUpdate.mockResolvedValue({ id: "c1", deletedAt: now });
    const req = new Request("http://localhost", { method: "DELETE" });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.competitionUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("is idempotent: returns 200 without rewriting the column if already deleted", async () => {
    const earlier = new Date("2026-01-01T00:00:00Z");
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.competitionFindUnique.mockResolvedValue({
      id: "c1",
      name: "Test",
      deletedAt: earlier,
    });
    const req = new Request("http://localhost", { method: "DELETE" });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.competitionUpdate).not.toHaveBeenCalled();
  });
});
