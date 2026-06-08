/**
 * fixturedownload.com feed reader.
 *
 * Free public feed, no API key required. Returns a JSON array of
 * matches for a given league/season slug (e.g. "fifa-world-cup-2026").
 *
 * Used as a one-shot ingestion source for tournaments whose schedule
 * isn't (yet) available on api-football. The api-football integration
 * remains the primary source for live data and current-season leagues.
 *
 * Notes on the feed:
 *   - Date format is "YYYY-MM-DD HH:MM:SSZ" (space, not T) — must be
 *     normalized before Date parsing.
 *   - Knockout rounds use placeholder team names ("2A", "To be
 *     announced"). Filter these out at the call site.
 *   - No live status / score field — feed is schedule-only.
 */

const BASE_URL = process.env.FIXTUREDOWNLOAD_BASE ?? "https://fixturedownload.com";

export type FixturedownloadMatch = {
  MatchNumber: number;
  RoundNumber: number;
  /** "YYYY-MM-DD HH:MM:SSZ" */
  DateUtc: string;
  Location: string;
  HomeTeam: string;
  AwayTeam: string;
  /** "Group A" for group stage, null for knockouts */
  Group: string | null;
  HomeTeamScore: number | null;
  AwayTeamScore: number | null;
  /** "" = no winner yet, "Home"/"Away"/"Draw" when settled */
  Winner: string;
};

export class FixturedownloadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FixturedownloadError";
    this.status = status;
  }
}

export async function fetchFixtures(slug: string): Promise<FixturedownloadMatch[]> {
  const url = `${BASE_URL}/feed/json/${slug}`;
  const res = await fetch(url, {
    // Public feed, no auth. Re-fetch on each call — no caching needed
    // for one-shot ingestion.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new FixturedownloadError(
      `fixturedownload ${res.status} for slug ${slug}`,
      res.status,
    );
  }
  const data = (await res.json()) as FixturedownloadMatch[];
  if (!Array.isArray(data)) {
    throw new FixturedownloadError(
      `fixturedownload returned non-array for slug ${slug}`,
      500,
    );
  }
  return data;
}

/** Parse "YYYY-MM-DD HH:MM:SSZ" → Date. */
export function parseDateUtc(s: string): Date {
  // JS Date won't parse the space-separated format directly. Replace
  // the space with "T" so it becomes ISO 8601.
  return new Date(s.replace(" ", "T"));
}

/** Is this a placeholder team slot (knockout TBD) rather than a real team? */
export function isPlaceholderTeam(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.toLowerCase() === "to be announced") return true;
  // Knockout placeholders: "1A", "2B", "3CEFHIJ", "3DEIJL" etc. — short,
  // alphanumeric, no spaces.
  return /^[1-4][A-Z]+(\/[A-Z]+)*$/.test(trimmed);
}
