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

// ---- Match response shapes (v4 /competitions/{code}/matches) --------------

/**
 * A match as returned by football-data.org v4. Only the fields we
 * actually consume are typed; the rest are ignored. The full shape is
 * documented at https://docs.football-data.org/general/v4/matches.html.
 *
 * The `id` is the provider's permanent match id — we preserve it on
 * `Match.apiMatchId` so future sync calls can look the row up.
 *
 * `status` is the provider's status string. We map it onto our
 * 3-value enum in the ingest layer:
 *   FINISHED              → FINISHED
 *   IN_PLAY | PAUSED      → GOING
 *   anything else (TIMED, SCHEDULED, …) → SCHEDULED
 */
export type Match = {
  id: number;
  utcDate: string; // ISO 8601
  status:
    | "SCHEDULED"
    | "TIMED"
    | "IN_PLAY"
    | "PAUSED"
    | "FINISHED"
    | "AWARDED"
    | "CANCELLED"
    | "POSTPONED";
  matchday: number | null;
  stage: string | null;
  group: string | null;
  lastUpdated: string | null;
  homeTeam: {
    id: number;
    name: string;
    shortName: string | null;
    tla: string | null;
    crest: string | null;
  };
  awayTeam: {
    id: number;
    name: string;
    shortName: string | null;
    tla: string | null;
    crest: string | null;
  };
  score: {
    winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    duration: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT" | null;
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    extraTime: { home: number | null; away: number | null } | null;
    /**
     * Shootout penalties. Not used by any market — the IN_GAME_PENALTY
     * market tracks in-game penalties awarded during regular/extra
     * time, not the post-match shootout. The column is still present
     * in the API response for completeness.
     */
    penalties: { home: number | null; away: number | null } | null;
  };
  referees: { id: number; name: string; type: string | null; nationality: string | null }[];
  /** Odds block — provider may attach one or more bookmaker entries.
   *  We don't consume these; the type is left as `unknown`. */
  odds?: unknown;
};

type GetMatchesResponse = {
  filters: Record<string, unknown>;
  resultSet: { count: number; first: string | null; last: string | null; played: number };
  competition: Competition;
  matches: Match[];
};

/**
 * Response shape for GET /v4/competitions/{code} (the single-competition
 * endpoint). Compatible with our `Competition` type PLUS a `seasons`
 * array listing the competition's historical seasons.
 */
type GetCompetitionResponse = Competition & {
  seasons: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number | null;
    winner: unknown;  // varies: null for the current season, an object for past seasons
  }[];
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

// ---- Per-competition helpers ---------------------------------------------

/**
 * Look up a single competition by its football-data.org code
 * (e.g. "PL" for Premier League, "WC" for World Cup). Returns null if
 * the code does not resolve to a known competition.
 *
 * Hits GET /v4/competitions/{code}. The response is the Competition
 * directly (not wrapped in an envelope) PLUS a `seasons` array.
 *
 * NOTE: The caller only uses `name` and `currentSeason` — both are
 * present on our `Competition` type and on the actual response.
 */
export async function getCompetition(
  code: string,
): Promise<GetCompetitionResponse | null> {
  const result = await call<GetCompetitionResponse>(
    `/competitions/${encodeURIComponent(code)}`,
  );
  return result;
}

/**
 * Fetch every match in a competition for a given season/matchday. The
 * `code` argument is the football-data.org competition code, NOT the
 * numeric id. Returns the inner `matches` array (not the envelope).
 *
 * Hits GET /v4/competitions/{code}/matches.
 *
 *   opts.season    Year the season started (e.g. 2026). When omitted,
 *                  the API returns the current season by default.
 *   opts.matchday  Restrict to a single matchday (1-based).
 */
export async function getCompetitionMatches(
  code: string,
  opts: { season?: number; matchday?: number } = {},
): Promise<Match[]> {
  const params: Record<string, string | number> = {};
  if (opts.season !== undefined) params.season = opts.season;
  if (opts.matchday !== undefined) params.matchday = opts.matchday;

  const envelope = await call<GetMatchesResponse>(
    `/competitions/${encodeURIComponent(code)}/matches`,
    params,
  );
  return envelope.matches;
}

/**
 * Fetch a single match by its football-data.org numeric id. Returns
 * the Match object directly (not wrapped in an envelope).
 *
 * Hits GET /v4/matches/{id}. Used by the user-driven live-polling
 * endpoint at app/api/v1/matches/[id]/refresh/route.ts to pull the
 * latest score for one match without re-listing the whole
 * competition. Cached in the shared 5-min in-memory cache alongside
 * every other call.
 */
export async function getMatchById(id: number | string): Promise<Match> {
  return call<Match>(`/matches/${encodeURIComponent(String(id))}`);
}
