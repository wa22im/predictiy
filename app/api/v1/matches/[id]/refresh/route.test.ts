import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted mock state shared between the mock factories (which
// vitest hoists to the top of the file) and the test bodies.
const mocks = vi.hoisted(() => {
  return {
    matchFindUnique: vi.fn(),
    matchUpdate: vi.fn(),
    getUser: vi.fn(),
    getMatchById: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: () => mocks.getUser() },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    match: {
      findUnique: mocks.matchFindUnique,
      update: mocks.matchUpdate,
    },
  },
}));

vi.mock("@/lib/services/football-data", () => ({
  getMatchById: mocks.getMatchById,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: not authenticated. Tests override per-case.
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});

function makeMatchFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    status: "GOING",
    homeScore: 0,
    awayScore: 0,
    homeHtGoals: null,
    awayHtGoals: null,
    homePenalties: null,
    awayPenalties: null,
    // Default: kickoff was 30 min ago, match is in progress.
    kickoffTime: new Date(Date.now() - 30 * 60 * 1000),
    apiMatchId: "999",
    scoreLastSyncedAt: null,
    // The route reads `match.competition.externalSource` (the
    // source is on the parent competition, not the match itself).
    competition: { externalSource: "football-data" },
    ...overrides,
  };
}

describe("POST /api/v1/matches/[id]/refresh", () => {
  it("returns 401 when not authenticated", async () => {
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(401);
    expect(mocks.matchFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when id is missing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when match not found", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(null);
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns nextRefreshMs=null and reason=NOT_STARTED for SCHEDULED match with kickoffTime in the future", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({
        status: "SCHEDULED",
        // Kickoff in 1 hour — definitely pre-kickoff.
        kickoffTime: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nextRefreshMs).toBeNull();
    expect(body.reason).toBe("NOT_STARTED");
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });

  it("returns nextRefreshMs=null for FINISHED match", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({ status: "FINISHED" }),
    );
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nextRefreshMs).toBeNull();
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });

  it("returns cached data without API call when scoreLastSyncedAt is <5 min old", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({
        // 1 min ago — well within the 5-min rate limit.
        scoreLastSyncedAt: new Date(Date.now() - 60 * 1000),
      }),
    );
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(mocks.getMatchById).not.toHaveBeenCalled();
    // nextRefreshMs must be a number for a GOING match.
    expect(typeof body.nextRefreshMs).toBe("number");
  });

  it("hits football-data, updates the row, and returns fresh data when scoreLastSyncedAt is null and match has started", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({
        status: "GOING",
        homeScore: 0,
        awayScore: 0,
        scoreLastSyncedAt: null,
      }),
    );
    mocks.getMatchById.mockResolvedValue({
      id: 999,
      utcDate: "2026-06-13T20:00:00Z",
      status: "IN_PLAY",
      matchday: 1,
      stage: null,
      group: null,
      lastUpdated: null,
      homeTeam: { id: 1, name: "A", shortName: null, tla: null, crest: null },
      awayTeam: { id: 2, name: "B", shortName: null, tla: null, crest: null },
      score: {
        winner: null,
        duration: "REGULAR",
        fullTime: { home: 2, away: 1 },
        halfTime: { home: 1, away: 0 },
        extraTime: null,
        penalties: null,
      },
      referees: [],
    });
    mocks.matchUpdate.mockResolvedValue({});
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.homeScore).toBe(2);
    expect(body.awayScore).toBe(1);
    expect(body.scoreChanged).toBe(true);
    expect(body.status).toBe("GOING");
    // The row was written with the new score + the timestamp.
    expect(mocks.matchUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.matchUpdate.mock.calls[0][0];
    expect(updateArgs.data.homeScore).toBe(2);
    expect(updateArgs.data.awayScore).toBe(1);
    expect(updateArgs.data.scoreLastSyncedAt).toBeInstanceOf(Date);
    // The 30s interval is what computeNextRefreshMs returns when the
    // score just changed.
    expect(body.nextRefreshMs).toBe(30_000);
  });

  it("returns error: FETCH_FAILED when the upstream call throws; response includes cached data", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({ scoreLastSyncedAt: null }),
    );
    mocks.getMatchById.mockRejectedValue(new Error("network down"));
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBe("FETCH_FAILED");
    // No update written — the fetch failed before we touched the DB.
    expect(mocks.matchUpdate).not.toHaveBeenCalled();
  });

  it("returns reason: UNSUPPORTED_SOURCE for non-football-data matches", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({
        scoreLastSyncedAt: null,
        competition: { externalSource: "api-football" },
      }),
    );
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toBe("UNSUPPORTED_SOURCE");
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });

  it("GOING match with no score change returns scoreChanged=false and the 120s interval", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({
        status: "GOING",
        homeScore: 1,
        awayScore: 1,
        scoreLastSyncedAt: null,
      }),
    );
    // Upstream reports the same score as our row.
    mocks.getMatchById.mockResolvedValue({
      id: 999,
      utcDate: "2026-06-13T20:00:00Z",
      status: "IN_PLAY",
      matchday: 1,
      stage: null,
      group: null,
      lastUpdated: null,
      homeTeam: { id: 1, name: "A", shortName: null, tla: null, crest: null },
      awayTeam: { id: 2, name: "B", shortName: null, tla: null, crest: null },
      score: {
        winner: null,
        duration: "REGULAR",
        fullTime: { home: 1, away: 1 },
        halfTime: { home: 1, away: 0 },
        extraTime: null,
        penalties: null,
      },
      referees: [],
    });
    mocks.matchUpdate.mockResolvedValue({});
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoreChanged).toBe(false);
    // lastRefreshAgeMs passed to computeNextRefreshMs is 0 (we just
    // refreshed). The "no change, very recent" path returns 120_000.
    expect(body.nextRefreshMs).toBe(120_000);
  });

  it("maps a football-data FINISHED upstream to our FINISHED status", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.matchFindUnique.mockResolvedValue(
      makeMatchFixture({
        status: "GOING",
        homeScore: 1,
        awayScore: 1,
        scoreLastSyncedAt: null,
      }),
    );
    mocks.getMatchById.mockResolvedValue({
      id: 999,
      utcDate: "2026-06-13T20:00:00Z",
      status: "FINISHED",
      matchday: 1,
      stage: null,
      group: null,
      lastUpdated: null,
      homeTeam: { id: 1, name: "A", shortName: null, tla: null, crest: null },
      awayTeam: { id: 2, name: "B", shortName: null, tla: null, crest: null },
      score: {
        winner: "HOME_TEAM",
        duration: "REGULAR",
        fullTime: { home: 2, away: 1 },
        halfTime: { home: 1, away: 0 },
        extraTime: null,
        penalties: null,
      },
      referees: [],
    });
    mocks.matchUpdate.mockResolvedValue({});
    const req = new Request("http://localhost", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("FINISHED");
    expect(body.homeScore).toBe(2);
    expect(body.awayScore).toBe(1);
  });
});
