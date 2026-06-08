/**
 * api-football.com v3 client.
 *
 * Free tier: 100 requests/day. Every call is precious — we cache
 * responses in memory for the lifetime of the server process, key on
 * the full URL+params, and surface a single shared helper.
 *
 * API: https://v3.football.api-sports.io
 * Auth header: x-apisports-key: {FOOTBALL_API_KEY}
 * Docs: https://www.api-football.com/documentation-v3
 */

const BASE_URL = "https://v3.football.api-sports.io";

export class ApiFootballError extends Error {
  status: number;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiFootballError";
    this.status = status;
    this.body = body;
  }
}

// ---- Response shapes (only what we need) -----------------------------------

export type LeagueRef = {
  id: number;
  name: string;
  type: string;
  logo: string | null;
  country: { name: string; code: string | null; flag: string | null } | null;
};

export type LeagueSearchResult = {
  league: LeagueRef;
  seasons: { year: number; start: string; end: string; current: boolean }[];
};

export type FixtureStatus = {
  long: string;
  short: string;
  elapsed: number | null;
};

export type FixtureTeam = {
  id: number;
  name: string;
  logo: string | null;
  winner: boolean | null;
};

export type Fixture = {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string; // ISO
    timestamp: number; // unix seconds
    status: FixtureStatus;
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string | null;
    season: number;
    round: string | null;
  };
  teams: { home: FixtureTeam; away: FixtureTeam };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
};

type ApiResponse<T> = {
  get: string;
  parameters: Record<string, string>;
  errors: unknown[];
  results: number;
  response: T[];
};

// ---- In-memory cache ------------------------------------------------------

type CacheEntry = { expiresAt: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — same as our cron cadence

function cacheKey(path: string, params: Record<string, string | number>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
  return `${path}?${qs}`;
}

// ---- Public client --------------------------------------------------------

function getApiKey(): string {
  const key = process.env.FOOTBALL_API_KEY;
  if (!key) {
    throw new ApiFootballError(
      "FOOTBALL_API_KEY not set in environment. Add it to .env.local — free tier at api-football.com.",
      500,
    );
  }
  return key;
}

async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const key = cacheKey(path, params);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T[];
  }

  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: { "x-apisports-key": getApiKey() },
    // Re-fetch on the server side; never cache HTTP responses at the
    // framework level (we have our own cache above).
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => undefined);
    throw new ApiFootballError(
      `api-football ${res.status}: ${res.statusText}`,
      res.status,
      body,
    );
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
    // api-football sometimes returns 200 with errors[] populated for
    // invalid params. Surface as an error.
    throw new ApiFootballError(
      `api-football returned errors: ${JSON.stringify(json.errors)}`,
      400,
      json.errors,
    );
  }

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data: json.response });
  return json.response;
}

// ---- Public typed helpers -------------------------------------------------

/** Search leagues by name (e.g., "Premier", "Liga", "Champions"). */
export async function searchLeagues(query: string): Promise<LeagueSearchResult[]> {
  if (!query.trim()) return [];
  return call<LeagueSearchResult>("/leagues", { search: query.trim() });
}

/** Fetch all fixtures for a league in a season. */
export async function getLeagueFixtures(leagueId: number, season: number): Promise<Fixture[]> {
  return call<Fixture>("/fixtures", { league: leagueId, season });
}

/** Fetch a single fixture by its api-football ID. */
export async function getFixture(fixtureId: number): Promise<Fixture | null> {
  const result = await call<Fixture>("/fixtures", { id: fixtureId });
  return result[0] ?? null;
}

/** Clear the in-memory cache. Useful for tests. */
export function clearCache(): void {
  cache.clear();
}

/** Number of cached entries — useful for debugging. */
export function cacheSize(): number {
  return cache.size;
}
