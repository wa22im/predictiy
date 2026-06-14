/**
 * Tests for the football-data vendor adapter. Table-driven: each case
 * feeds a synthetic football-data.org v4 match into
 * `mapFootballDataMatch` and checks the resulting `MatchInput`.
 *
 * Note: the mapping helpers are not exported (they're internal to
 * the adapter), so we test them indirectly through the adapter's
 * public `fetchMatches` / `fetchMatch` methods. Each test mocks the
 * football-data V4 client and asserts on what the adapter returns.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCompetition = vi.fn();
const getCompetitionMatches = vi.fn();
const getMatchById = vi.fn();

vi.mock("@/lib/services/football-data", () => ({
  getCompetition: (...args: unknown[]) => getCompetition(...args),
  getCompetitionMatches: (...args: unknown[]) => getCompetitionMatches(...args),
  getMatchById: (...args: unknown[]) => getMatchById(...args),
}));

import { footballDataAdapter } from "./football-data";
import type { Match as FootballDataMatch } from "@/lib/services/football-data";

function makeFootballDataMatch(over: Partial<FootballDataMatch> = {}): FootballDataMatch {
  return {
    id: over.id ?? 1,
    utcDate: over.utcDate ?? "2026-04-15T20:00:00Z",
    status: over.status ?? "TIMED",
    matchday: over.matchday ?? 1,
    stage: over.stage ?? "GROUP_STAGE",
    group: over.group ?? "Group A",
    lastUpdated: over.lastUpdated ?? "2026-04-15T20:00:00Z",
    homeTeam: {
      id: 1,
      name: "Real Madrid",
      shortName: "Real Madrid",
      tla: "RMA",
      crest: "https://crests.football-data.org/real-madrid.svg",
      ...over.homeTeam,
    },
    awayTeam: {
      id: 2,
      name: "Liverpool",
      shortName: "Liverpool",
      tla: "LIV",
      crest: "https://crests.football-data.org/liverpool.svg",
      ...over.awayTeam,
    },
    score: {
      winner: over.score?.winner ?? null,
      duration: over.score?.duration ?? null,
      fullTime: over.score?.fullTime ?? { home: null, away: null },
      halfTime: over.score?.halfTime ?? { home: null, away: null },
      extraTime: over.score?.extraTime ?? null,
      penalties: over.score?.penalties ?? null,
    },
    referees: over.referees ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("footballDataAdapter", () => {
  describe("identity", () => {
    it("reports its name as 'football-data'", () => {
      expect(footballDataAdapter.name).toBe("football-data");
    });
  });

  describe("fetchCompetition", () => {
    it("maps a football-data competition to CompetitionInput with rich details", async () => {
      getCompetition.mockResolvedValueOnce({
        id: 2001,
        area: { id: 2077, name: "Europe", code: "EUR", flag: null },
        name: "UEFA Champions League",
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
        numberOfAvailableSeasons: 12,
        lastUpdated: "2026-04-15T20:00:00Z",
        seasons: [],
      });

      const result = await footballDataAdapter.fetchCompetition("CL");

      expect(getCompetition).toHaveBeenCalledWith("CL");
      expect(result.externalId).toBe("CL");
      expect(result.name).toBe("UEFA Champions League");
      expect(result.externalSeason).toBe(2025);
      // The details object should carry the rich metadata that the
      // sync path expects.
      const details = result.details as Record<string, unknown>;
      expect(details.code).toBe("CL");
      expect(details.type).toBe("CUP");
      expect(details.emblem).toBe("https://crests.football-data.org/CL.svg");
      expect(details.plan).toBe("TIER_ONE");
      expect(details.isActive).toBe(true);
      // endDate is 2026-05-30; grace is +7 days = 2026-06-06.
      expect(details.endDateWithGrace).toBe("2026-06-06T00:00:00.000Z");
    });

    it("marks isActive=false when currentSeason.winner is non-null", async () => {
      getCompetition.mockResolvedValueOnce({
        id: 2001,
        area: { id: 2077, name: "Europe", code: "EUR", flag: null },
        name: "UEFA Champions League",
        code: "CL",
        type: "CUP",
        emblem: null,
        plan: "TIER_ONE",
        currentSeason: {
          id: 2359,
          startDate: "2024-09-17",
          endDate: "2024-06-01",
          currentMatchday: 8,
          winner: { id: 760, name: "Real Madrid", tla: "RMA", crest: null },
        },
        numberOfAvailableSeasons: 12,
        lastUpdated: "2024-06-01T22:00:00Z",
        seasons: [],
      });

      const result = await footballDataAdapter.fetchCompetition("CL");
      const details = result.details as Record<string, unknown>;
      expect(details.isActive).toBe(false);
    });

    it("uses current calendar year when currentSeason is null", async () => {
      getCompetition.mockResolvedValueOnce({
        id: 2001,
        area: { id: 2077, name: "Europe", code: "EUR", flag: null },
        name: "TBD Cup",
        code: "TBD",
        type: "CUP",
        emblem: null,
        plan: "OTHER",
        currentSeason: null,
        numberOfAvailableSeasons: 0,
        lastUpdated: null,
        seasons: [],
      });

      const result = await footballDataAdapter.fetchCompetition("TBD");
      // No current season → use current calendar year as fallback.
      expect(result.externalSeason).toBe(new Date().getFullYear());
      const details = result.details as Record<string, unknown>;
      expect(details.endDateWithGrace).toBeNull();
    });
  });

  describe("fetchMatches (table-driven mapping)", () => {
    it("maps a SCHEDULED match correctly", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ id: 1, status: "TIMED" }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(getCompetitionMatches).toHaveBeenCalledWith("CL");
      expect(matches).toHaveLength(1);
      const m = matches[0];
      expect(m.externalId).toBe("1");
      expect(m.homeTeam).toBe("Real Madrid");
      expect(m.awayTeam).toBe("Liverpool");
      expect(m.stage).toBe("GROUP_STAGE");
      expect(m.status).toBe("SCHEDULED");
      expect(m.homeScore).toBeNull();
      expect(m.awayScore).toBeNull();
    });

    it("maps a FINISHED match with score to the FINISHED status", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({
          id: 2,
          status: "FINISHED",
          stage: "FINAL",
          score: {
            winner: "HOME_TEAM",
            duration: "REGULAR",
            fullTime: { home: 2, away: 1 },
            halfTime: { home: 1, away: 0 },
            extraTime: null,
            penalties: null,
          },
        }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      const m = matches[0];
      expect(m.status).toBe("FINISHED");
      expect(m.stage).toBe("FINAL");
      expect(m.homeScore).toBe(2);
      expect(m.awayScore).toBe(1);
    });

    it("maps IN_PLAY to GOING (live match)", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({
          id: 3,
          status: "IN_PLAY",
          score: {
            winner: null,
            duration: "REGULAR",
            fullTime: { home: 1, away: 0 },
            halfTime: { home: 1, away: 0 },
            extraTime: null,
            penalties: null,
          },
        }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].status).toBe("GOING");
    });

    it("maps PAUSED (HT) to GOING", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ id: 4, status: "PAUSED" }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].status).toBe("GOING");
    });

    it("maps AWARDED to FINISHED", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ id: 5, status: "AWARDED" }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].status).toBe("FINISHED");
    });

    it("maps CANCELLED to SCHEDULED (treats as not-yet-started)", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ id: 6, status: "CANCELLED" }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].status).toBe("SCHEDULED");
    });

    it("normalizes the 2024-25 Champions League stage LEAGUE_STAGE → GROUP_STAGE", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ id: 7, stage: "LEAGUE_STAGE" }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].stage).toBe("GROUP_STAGE");
    });

    it("normalizes PLAYOFFS → ROUND_OF_16 (new CL early knockout)", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ id: 8, stage: "PLAYOFFS" }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].stage).toBe("ROUND_OF_16");
    });

    it("embeds vendor-specific fields into details (matchday, group, scoreWinner, crests)", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({
          id: 9,
          matchday: 5,
          group: "Group B",
          score: {
            winner: "AWAY_TEAM",
            duration: "REGULAR",
            fullTime: { home: 0, away: 1 },
            halfTime: { home: 0, away: 1 },
            extraTime: null,
            penalties: null,
          },
        }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      const m = matches[0];
      const details = m.details as Record<string, unknown>;
      expect(details.matchday).toBe(5);
      expect(details.group).toBe("Group B");
      expect(details.scoreWinner).toBe("AWAY_TEAM");
      expect(details.scoreDuration).toBe("REGULAR");
      // Team crest URLs are also stored in details (the typed columns
      // homeCrest / awayCrest are populated by the apply step).
      expect(details.homeCrest).toBe("https://crests.football-data.org/real-madrid.svg");
      expect(details.awayCrest).toBe("https://crests.football-data.org/liverpool.svg");
      // The raw status string is preserved for debugging.
      expect(details.externalStatus).toBe("TIMED");
    });

    it("converts the match id to a string (so it works as apiMatchId later)", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ id: 424242 }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].externalId).toBe("424242");
      expect(typeof matches[0].externalId).toBe("string");
    });

    it("parses the ISO utcDate string into a Date object", async () => {
      getCompetitionMatches.mockResolvedValueOnce([
        makeFootballDataMatch({ utcDate: "2026-06-01T18:00:00Z" }),
      ]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches[0].kickoffTime).toBeInstanceOf(Date);
      expect(matches[0].kickoffTime.toISOString()).toBe("2026-06-01T18:00:00.000Z");
    });

    it("returns an empty array when the API returns no matches", async () => {
      getCompetitionMatches.mockResolvedValueOnce([]);
      const matches = await footballDataAdapter.fetchMatches("CL", 2025);
      expect(matches).toEqual([]);
    });
  });

  describe("fetchMatch (single-match lookup)", () => {
    it("fetches a single match and maps it", async () => {
      getMatchById.mockResolvedValueOnce(
        makeFootballDataMatch({ id: 99, status: "FINISHED" }),
      );
      const match = await footballDataAdapter.fetchMatch("99");
      expect(getMatchById).toHaveBeenCalledWith("99");
      expect(match.externalId).toBe("99");
      expect(match.status).toBe("FINISHED");
    });
  });
});
