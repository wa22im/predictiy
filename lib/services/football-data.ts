/**
 * football-data.org v4 client.
 *
 * Free tier: 10 requests/minute. Every call is precious — we cache
 * responses in memory for the lifetime of the server process, key on
 * the full URL+params, and surface a single shared helper.
 *
 * API: https://api.football-data.org/v4
 * Auth header: X-Auth-Token: {FOOTBALL_DATA_TOKEN}
 * Docs: https://docs.football-data.org/general/v4/index.html
 *
 * NOTE: This client coexists with `api-football.ts`. The old client is
 * retained for the existing ingested competition data (see 6.x) and
 * for the cron pipeline; this client is the foundation for the new
 * admin discover flow (Phase 7.11). A future session will migrate the
 * ingest pipeline to this client.
 */

import "server-only";

const BASE_URL = "https://api.football-data.org/v4";

export class FootballDataError extends Error {
  status: number;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "FootballDataError";
    this.status = status;
    this.body = body;
  }
}

// ---- Response shapes -------------------------------------------------------

export type CompetitionArea = {
  id: number;
  name: string;
  code: string | null;
  flag: string | null;
};

export type CompetitionSeason = {
  id: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  currentMatchday: number | null;
  winner: string | null;
};

export type CompetitionType = "LEAGUE" | "CUP" | "PLAYOFF" | "SUPER_CUP" | "OTHER";

export type CompetitionPlan =
  | "TIER_ONE"
  | "TIER_TWO"
  | "TIER_THREE"
  | "TIER_FOUR"
  | "DOMESTIC"
  | "INTERNATIONAL"
  | "OTHER";

export type Competition = {
  id: number;
  area: CompetitionArea;
  name: string;
  code: string | null;
  type: CompetitionType;
  emblem: string | null;
  plan: CompetitionPlan;
  currentSeason: CompetitionSeason | null;
  numberOfAvailableSeasons: number;
  lastUpdated: string | null;
};

type ListCompetitionsResponse = {
  count: number;
  filters: Record<string, unknown>;
  competitions: Competition[];
};

// ---- In-memory cache -------------------------------------------------------

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

function getApiToken(): string {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    throw new FootballDataError(
      "FOOTBALL_DATA_TOKEN not set in environment. Add it to .env.local — free tier at football-data.org.",
      500,
    );
  }
  return token;
}

async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = cacheKey(path, params);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: { "X-Auth-Token": getApiToken() },
    // Re-fetch on the server side; never cache HTTP responses at the
    // framework level (we have our own cache above).
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => undefined);
    throw new FootballDataError(
      `football-data.org ${res.status}: ${res.statusText}`,
      res.status,
      body,
    );
  }

  const json = (await res.json()) as T;
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data: json });
  return json;
}

// ---- Public typed helpers -------------------------------------------------

/**
 * List competitions. Optional filters:
 *   - areaId: restrict to a single area/country id
 *   - type:   restrict to one competition type
 *
 * Returns the array of Competition objects (not the envelope).
 * Hits GET /v4/competitions.
 */
export async function listCompetitions(
  opts: { areaId?: number; type?: CompetitionType } = {},
): Promise<Competition[]> {
  const params: Record<string, string | number> = {};
  if (opts.areaId !== undefined) params.areas = opts.areaId;
  if (opts.type !== undefined) params.type = opts.type;

  const envelope = await call<ListCompetitionsResponse>("/competitions", params);
  return envelope.competitions;
}

/** Clear the in-memory cache. Useful for tests. */
export function clearCache(): void {
  cache.clear();
}

/** Number of cached entries — useful for debugging. */
export function cacheSize(): number {
  return cache.size;
}
