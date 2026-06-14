import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock server-only so the service module is importable in unit tests.
vi.mock("server-only", () => ({}));

const competitionFindUnique = vi.fn();
const competitionUpdate = vi.fn();
const matchFindUnique = vi.fn();
const matchUpsert = vi.fn();
const betMarketFindUnique = vi.fn();
const betMarketUpsert = vi.fn();
const getCompetitionMatches = vi.fn();
const getCompetition = vi.fn();
const autoSettleMatch = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    competition: {
      findUnique: (...args: unknown[]) => competitionFindUnique(...args),
      update: (...args: unknown[]) => competitionUpdate(...args),
    },
    match: {
      findUnique: (...args: unknown[]) => matchFindUnique(...args),
      upsert: (...args: unknown[]) => matchUpsert(...args),
    },
    betMarket: {
      findUnique: (...args: unknown[]) => betMarketFindUnique(...args),
      upsert: (...args: unknown[]) => betMarketUpsert(...args),
    },
  },
}));

vi.mock("@/lib/services/football-data", () => ({
  getCompetition: (...args: unknown[]) => getCompetition(...args),
  getCompetitionMatches: (...args: unknown[]) => getCompetitionMatches(...args),
}));

vi.mock("@/lib/services/auto-settle", () => ({
  autoSettleMatch: (...args: unknown[]) => autoSettleMatch(...args),
}));

import { syncFootballDataCompetition, SyncError } from "./sync-football-data-competition";

/**
 * Test fixture: a Champions-League-shaped competition row. The sync
 * function only ever reads these six fields; everything else is
 * fetched and merged into the `details` JSONB.
 */
function makeCompetitionRow(over: Partial<{
  id: string;
  name: string;
  externalSource: string | null;
  externalLeagueId: string | null;
  externalSeason: number | null;
  details: Record<string, unknown> | null;
}> = {}) {
  // Use `in` checks rather than `??` so an explicit `null` passed in
  // the override is preserved (vs. the default which would replace
  // it). Some tests deliberately pass null fields to exercise the
  // "missing external linkage" guard in the sync function.
  return {
    id: "id" in over ? over.id : "comp-1",
    name: "name" in over ? over.name : "Champions League",
    externalSource: "externalSource" in over ? over.externalSource : "football-data",
    externalLeagueId: "externalLeagueId" in over ? over.externalLeagueId : "CL",
    externalSeason: "externalSeason" in over ? over.externalSeason : 2025,
    details: "details" in over ? over.details : null,
  };
}

/**
 * Test fixture: a single football-data.org match. Only the fields
 * `applyFootballDataMatches` actually reads are populated. The
 * fixture intentionally exercises a non-FINAL status so auto-settle
 * does NOT fire (keeping the test focused on the sync-side merge
 * behavior).
 */
function makeMatch(over: Partial<{
  id: number;
  stage: string;
  status: "SCHEDULED" | "TIMED" | "IN_PLAY" | "PAUSED" | "FINISHED";
  utcDate: string;
  homeScore: number | null;
  awayScore: number | null;
  matchday: number | null;
  group: string | null;
  winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
  duration: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT" | null;
}> = {}) {
  return {
    id: over.id ?? 1,
    utcDate: over.utcDate ?? "2026-04-15T20:00:00Z",
    status: over.status ?? "SCHEDULED",
    matchday: over.matchday ?? 1,
    stage: over.stage ?? "GROUP_STAGE",
    group: over.group ?? "Group A",
    lastUpdated: "2026-04-15T20:00:00Z",
    homeTeam: { id: 1, name: "Real Madrid", shortName: "Real Madrid", tla: "RMA", crest: null },
    awayTeam: { id: 2, name: "Liverpool", shortName: "Liverpool", tla: "LIV", crest: null },
    score: {
      winner: over.winner ?? null,
      duration: over.duration ?? null,
      fullTime: { home: over.homeScore ?? null, away: over.awayScore ?? null },
      halfTime: { home: null, away: null },
      extraTime: null,
      penalties: null,
    },
    referees: [],
  };
}

/**
 * Test fixture: a `getCompetition` response. Mirrors the live API
 * shape: nested `area`, nested `currentSeason` with `winner` (null
 * for ongoing, object for finished). The `seasons` array is part of
 * the real `GetCompetitionResponse` type but the sync code doesn't
 * read it, so we omit it.
 */
function makeCompetitionMetadata(over: Partial<{
  id: number;
  area: { id: number; name: string; code: string | null; flag: string | null };
  code: string | null;
  type: "LEAGUE" | "CUP" | "PLAYOFF" | "SUPER_CUP" | "OTHER";
  emblem: string | null;
  plan: "TIER_ONE" | "TIER_TWO" | "TIER_THREE" | "TIER_FOUR" | "DOMESTIC" | "INTERNATIONAL" | "OTHER";
  currentSeason: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number | null;
    winner: unknown;
  } | null;
  numberOfAvailableSeasons: number;
  lastUpdated: string | null;
}> = {}) {
  return {
    id: over.id ?? 2001,
    area: over.area ?? { id: 2077, name: "Europe", code: "EUR", flag: null },
    name: "UEFA Champions League",
    code: over.code ?? "CL",
    type: over.type ?? "CUP",
    emblem: over.emblem ?? "https://crests.football-data.org/CL.svg",
    plan: over.plan ?? "TIER_ONE",
    currentSeason: over.currentSeason ?? {
      id: 2415,
      startDate: "2025-09-16",
      endDate: "2026-05-30",
      currentMatchday: 8,
      winner: null,
    },
    numberOfAvailableSeasons: over.numberOfAvailableSeasons ?? 12,
    lastUpdated: over.lastUpdated ?? "2026-04-15T20:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the competition row exists with a valid
  // externalSource / externalLeagueId / externalSeason. The
  // metadata read (select: { details: true }) returns null so the
  // merge path is a no-op unless a test overrides it.
  //
  // Note: we use mockImplementation so the dispatch between the
  // full-row read and the details-only read is by call argument.
  // Tests that want a different first call should set up a fresh
  // implementation before calling the service.
  competitionFindUnique.mockImplementation(
    async (arg: { where?: { id?: string }; select?: { details?: boolean } }) => {
      if (arg?.where?.id !== "comp-1") return null;
      if (arg?.select?.details) {
        return { details: null };
      }
      return makeCompetitionRow();
    },
  );
  matchFindUnique.mockResolvedValue(null);
  matchUpsert.mockImplementation(async (arg: { create: { apiMatchId: string } }) => ({
    id: `match-row-${arg.create.apiMatchId}`,
  }));
  betMarketFindUnique.mockResolvedValue(null);
  betMarketUpsert.mockResolvedValue({});
  autoSettleMatch.mockResolvedValue({ settlements: [], warnings: [] });
  getCompetitionMatches.mockResolvedValue([]);
  getCompetition.mockResolvedValue(makeCompetitionMetadata());
  competitionUpdate.mockResolvedValue({});
});

describe("syncFootballDataCompetition", () => {
  describe("input validation", () => {
    it("rejects a missing competitionId with a 400 SyncError", async () => {
      await expect(syncFootballDataCompetition("")).rejects.toBeInstanceOf(SyncError);
      await expect(syncFootballDataCompetition("")).rejects.toMatchObject({ status: 400 });
    });

    it("returns 404 when the competition row is missing", async () => {
      // beforeEach default returns null for any id !== "comp-1"
      await expect(syncFootballDataCompetition("missing")).rejects.toMatchObject({ status: 404 });
    });

    it("rejects competitions not linked to football-data with a 400", async () => {
      competitionFindUnique.mockImplementationOnce(
        async () => makeCompetitionRow({ externalSource: "api-football" }),
      );
      await expect(syncFootballDataCompetition("comp-1")).rejects.toMatchObject({ status: 400 });
    });

    it("rejects competitions missing externalLeagueId", async () => {
      competitionFindUnique.mockImplementationOnce(
        async () => makeCompetitionRow({ externalLeagueId: null }),
      );
      await expect(syncFootballDataCompetition("comp-1")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("rich metadata population", () => {
    it("populates Competition.details with area/code/type/emblem/plan/currentSeason/availableSeasons/lastUpdated/isActive/endDateWithGrace", async () => {
      // The beforeEach default already returns { details: null }
      // for the select.details call, which is what we want here.
      getCompetition.mockResolvedValueOnce(makeCompetitionMetadata());

      await syncFootballDataCompetition("comp-1");

      const updateCall = competitionUpdate.mock.calls[0][0];
      expect(updateCall.data.details).toEqual({
        area: { id: 2077, name: "Europe", code: "EUR", flag: null },
        code: "CL",
        type: "CUP",
        emblem: "https://crests.football-data.org/CL.svg",
        plan: "TIER_ONE",
        currentSeason: {
          id: 2415,
          startDate: "2025-09-16",
          endDate: "2026-05-30",
          currentMatchday: 8,
          winner: null,
        },
        availableSeasons: 12,
        lastUpdated: "2026-04-15T20:00:00Z",
        isActive: true,
        // CL ends 2026-05-30 → grace is 7 days later = 2026-06-06.
        endDateWithGrace: "2026-06-06T00:00:00.000Z",
      });
    });

    it("also updates the typed Competition.endDate column from currentSeason.endDate", async () => {
      await syncFootballDataCompetition("comp-1");

      const updateCall = competitionUpdate.mock.calls[0][0];
      expect(updateCall.data.endDate).toBeInstanceOf(Date);
      expect(updateCall.data.endDate?.getTime()).toBe(Date.UTC(2026, 4, 30));
    });

    it("stamps lastSyncedAt on every successful sync", async () => {
      const before = Date.now();
      await syncFootballDataCompetition("comp-1");
      const after = Date.now();
      const ts = competitionUpdate.mock.calls[0][0].data.lastSyncedAt;
      expect(ts).toBeInstanceOf(Date);
      expect(ts.getTime()).toBeGreaterThanOrEqual(before);
      expect(ts.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe("isActive flag", () => {
    it("is true when currentSeason.winner is null (season still ongoing)", async () => {
      getCompetition.mockResolvedValueOnce(
        makeCompetitionMetadata({
          currentSeason: {
            id: 2415,
            startDate: "2025-09-16",
            endDate: "2026-05-30",
            currentMatchday: 8,
            winner: null,
          },
        }),
      );

      await syncFootballDataCompetition("comp-1");
      const details = competitionUpdate.mock.calls[0][0].data.details;
      expect(details.isActive).toBe(true);
    });

    it("is false when currentSeason.winner is an object (season finished)", async () => {
      getCompetition.mockResolvedValueOnce(
        makeCompetitionMetadata({
          currentSeason: {
            id: 2359,
            startDate: "2024-06-14",
            endDate: "2024-07-14",
            currentMatchday: 7,
            winner: { id: 760, name: "Spain", tla: "ESP", crest: null },
          },
        }),
      );

      await syncFootballDataCompetition("comp-1");
      const details = competitionUpdate.mock.calls[0][0].data.details;
      expect(details.isActive).toBe(false);
      // The winner object should be preserved in details.currentSeason.winner
      expect(details.currentSeason.winner).toEqual({
        id: 760,
        name: "Spain",
        tla: "ESP",
        crest: null,
      });
    });
  });

  describe("endDateWithGrace (7-day grace period)", () => {
    it("computes endDateWithGrace as endDate + 7 days (CL ends 2026-05-30 → 2026-06-06)", async () => {
      // The default fixture's currentSeason.endDate is "2026-05-30"
      // → grace date is "2026-06-06".
      getCompetition.mockResolvedValueOnce(makeCompetitionMetadata());
      await syncFootballDataCompetition("comp-1");
      const details = competitionUpdate.mock.calls[0][0].data.details;
      expect(details.endDateWithGrace).toBe("2026-06-06T00:00:00.000Z");
    });

    it("endDateWithGrace is null when endDate is null (tournament has no scheduled end)", async () => {
      // A season with no endDate in the API response (e.g. an
      // open-ended cup) should not produce a grace date.
      getCompetition.mockResolvedValueOnce(
        makeCompetitionMetadata({
          currentSeason: {
            id: 2415,
            startDate: "2025-09-16",
            // endDate omitted → currentSeason is null per the type
            // definition. We model it as the field being absent.
            endDate: "",
            currentMatchday: 1,
            winner: null,
          } as unknown as ReturnType<typeof makeCompetitionMetadata>["currentSeason"],
        }),
      );
      await syncFootballDataCompetition("comp-1");
      const details = competitionUpdate.mock.calls[0][0].data.details;
      // Empty endDate string → parseCompetitionEndDate returns
      // undefined → endDate is undefined → no grace date.
      expect(details.endDateWithGrace).toBeNull();
    });
  });

  describe("metadata refresh failure is non-fatal", () => {
    it("still stamps lastSyncedAt when getCompetition throws, and does not touch details", async () => {
      getCompetition.mockRejectedValueOnce(new Error("503 Service Unavailable"));
      // matches succeed (empty)
      getCompetitionMatches.mockResolvedValueOnce([]);

      const result = await syncFootballDataCompetition("comp-1");

      // The sync returned successfully (no throw).
      expect(result.fetched).toBe(0);
      // lastSyncedAt is set...
      expect(competitionUpdate.mock.calls[0][0].data.lastSyncedAt).toBeInstanceOf(Date);
      // ...but details was NOT updated (the metadata refresh failed
      // and the richDetails short-circuit means we never read the
      // existing row to merge into).
      expect(competitionUpdate.mock.calls[0][0].data.details).toBeUndefined();
      // endDate is also not set (because the refresh failed and we
      // never resolved a valid end date).
      expect(competitionUpdate.mock.calls[0][0].data.endDate).toBeUndefined();
    });
  });

  describe("merge preserves user-set fields", () => {
    it("preserves an existing scoringOverridesByStage field across the sync", async () => {
      // Existing row: details has both API-shaped fields (from a
      // prior sync) and a user-set scoringOverridesByStage. The
      // merge must keep scoringOverridesByStage and let API fields
      // refresh the rest.
      const existingDetails = {
        area: { id: 999, name: "Stale Area", code: "ZZZ", flag: null },
        code: "ZZ",
        type: "LEAGUE",
        emblem: "https://stale.example/emblem.svg",
        plan: "TIER_THREE",
        currentSeason: {
          id: 1,
          startDate: "2024-01-01",
          endDate: "2024-12-31",
          currentMatchday: 38,
          winner: { id: 1, name: "Old Winner", tla: "OW", crest: null },
        },
        availableSeasons: 1,
        lastUpdated: "2024-12-31T23:59:59Z",
        isActive: false,
        // USER-SET FIELD — must survive the merge.
        scoringOverridesByStage: {
          FINAL: { exactScorePoints: 99 },
        },
      };

      // The sync function makes two findUnique calls: the first
      // reads the row (returns makeCompetitionRow via the default
      // impl), the second reads details only. We need the second
      // call to return our pre-existing JSONB blob.
      competitionFindUnique.mockImplementationOnce(
        async () => makeCompetitionRow(),
      );
      competitionFindUnique.mockImplementationOnce(
        async () => ({ details: existingDetails }),
      );
      // Fresh API response — every field different from the existing
      // details, so we can prove the API fields refresh.
      getCompetition.mockResolvedValueOnce(makeCompetitionMetadata());

      await syncFootballDataCompetition("comp-1");

      const details = competitionUpdate.mock.calls[0][0].data.details;
      // API-fetched fields are refreshed:
      expect(details.code).toBe("CL");
      expect(details.emblem).toBe("https://crests.football-data.org/CL.svg");
      expect(details.isActive).toBe(true);
      expect(details.currentSeason.currentMatchday).toBe(8);
      // User-set field is preserved:
      expect(details.scoringOverridesByStage).toEqual({
        FINAL: { exactScorePoints: 99 },
      });
    });

    it("does not introduce a scoringOverridesByStage key when the existing row has none", async () => {
      // beforeEach default already returns { details: null } for
      // the details-only read, which is the no-user-field case.
      getCompetition.mockResolvedValueOnce(makeCompetitionMetadata());

      await syncFootballDataCompetition("comp-1");
      const details = competitionUpdate.mock.calls[0][0].data.details;
      expect("scoringOverridesByStage" in details).toBe(false);
    });

    it("recomputes endDateWithGrace from the latest API endDate (does not preserve stale values)", async () => {
      // Existing details has a stale endDateWithGrace from a prior
      // sync. The new sync must overwrite it with a fresh value
      // derived from the current API response.
      const existingDetails = {
        area: { id: 999, name: "Stale Area", code: "ZZZ", flag: null },
        code: "ZZ",
        type: "LEAGUE",
        emblem: "https://stale.example/emblem.svg",
        plan: "TIER_THREE",
        currentSeason: {
          id: 1,
          startDate: "2024-01-01",
          endDate: "2024-12-31",
          currentMatchday: 38,
          winner: { id: 1, name: "Old Winner", tla: "OW", crest: null },
        },
        availableSeasons: 1,
        lastUpdated: "2024-12-31T23:59:59Z",
        isActive: false,
        // Stale grace date from 2024 (one year off).
        endDateWithGrace: "2025-01-07T00:00:00.000Z",
      };
      competitionFindUnique.mockImplementationOnce(
        async () => makeCompetitionRow(),
      );
      competitionFindUnique.mockImplementationOnce(
        async () => ({ details: existingDetails }),
      );
      getCompetition.mockResolvedValueOnce(makeCompetitionMetadata());

      await syncFootballDataCompetition("comp-1");
      const details = competitionUpdate.mock.calls[0][0].data.details;
      // Fresh value from the API response (endDate 2026-05-30 → 7 days later).
      expect(details.endDateWithGrace).toBe("2026-06-06T00:00:00.000Z");
    });
  });

  describe("apply path", () => {
    it("forwards matches to applyFootballDataMatches and returns its counts", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeMatch({ id: 1, stage: "GROUP_STAGE", status: "SCHEDULED" }),
        makeMatch({ id: 2, stage: "FINAL", status: "SCHEDULED" }),
      ]);
      // The first match is a fresh upsert (no prev row), the second
      // already exists.
      matchFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "match-row-2", status: "SCHEDULED" });

      const result = await syncFootballDataCompetition("comp-1");

      expect(result.fetched).toBe(2);
      // 1 created (no prev) + 1 updated (prev exists) = 2 total
      expect(result.createdMatches).toBe(1);
      expect(result.updatedMatches).toBe(1);
      expect(getCompetitionMatches).toHaveBeenCalledWith("CL", { season: 2025 });
    });

    it("auto-settles a match that transitions into FINISHED during this sync", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeMatch({ id: 1, stage: "FINAL", status: "FINISHED", homeScore: 2, awayScore: 1 }),
      ]);
      // prev was SCHEDULED → new is FINISHED → transition fires
      matchFindUnique.mockResolvedValueOnce({ id: "match-row-1", status: "SCHEDULED" });
      autoSettleMatch.mockResolvedValueOnce({
        settlements: [{ marketId: "mk-1" }, { marketId: "mk-2" }, { marketId: "mk-3" }],
        warnings: [],
      });

      const result = await syncFootballDataCompetition("comp-1");
      expect(result.settledMarkets).toBe(3);
      expect(autoSettleMatch).toHaveBeenCalledOnce();
    });
  });
});
