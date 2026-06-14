/**
 * Vendor adapter contract.
 *
 * Each data source (football-data.org, fixturedownload.com, future
 * providers) implements this interface. The cron iterates all
 * auto-syncable vendors (see the `VENDORS` list in `./index.ts`) and
 * dispatches each competition to the right adapter. New vendors are
 * added by:
 *   1. Implementing this interface in `lib/services/vendors/<vendor>.ts`
 *   2. Adding the vendor to the `REGISTRY` + `VENDORS` list in `./index.ts`
 *   3. Updating the Zod schema in `lib/validation/admin.ts` to accept
 *      the new `externalSource` value
 *
 * The adapter is a thin mapping layer: it knows how to talk to its
 * vendor's API and produce vendor-agnostic `CompetitionInput` /
 * `MatchInput` shapes. The actual database writes (competition
 * upsert, match upsert, market creation, settlement) live in the
 * existing service modules (e.g. `sync-football-data-competition.ts`,
 * `apply-football-data-matches.ts`) — the adapter doesn't write
 * directly to the DB.
 *
 * Why this shape:
 *   - `fetchCompetition` returns a single Competition's metadata so
 *     the caller can refresh the Competition row's typed columns
 *     (name, endDate) and `details` JSONB.
 *   - `fetchMatches` returns the full list of matches for a given
 *     league + season. The caller upserts each one and creates the
 *     default markets.
 *   - `fetchMatch` returns a single match by its vendor's id. Used
 *     by the per-match live-polling endpoint to refresh one row
 *     without re-listing the whole competition.
 *
 * Vendor identity:
 *   - `Vendor` is a closed set: `"football-data" | "fixturedownload" | "manual"`.
 *     `"manual"` means the data was hand-entered (Hydration Terminal
 *     or admin JSON) and is never auto-synced. The cron iterates the
 *     `VENDORS` list (which excludes `"manual"`) and dispatches each
 *     competition by its `externalSource` value.
 *   - `externalId` is the vendor's permanent id for the resource. On
 *     `Competition`, this becomes `Competition.externalLeagueId`
 *     (typically the vendor's league code or numeric id). On
 *     `Match`, it becomes `Match.apiMatchId` (a string — even when
 *     the vendor uses numeric ids, we store the string form for
 *     cross-vendor consistency).
 */

export type Vendor = "football-data" | "fixturedownload" | "manual";

/**
 * Vendor-agnostic shape for a competition as returned by an adapter.
 * The `details` JSONB carries everything vendor-specific (see
 * AGENTS.md "Vendor abstraction" section). The caller is responsible
 * for upserting the typed columns (name, endDate) and merging the
 * `details` blob into the existing row.
 */
export interface CompetitionInput {
  /** The vendor's permanent id (e.g. football-data's "CL"). */
  externalId: string;
  /** Display name. */
  name: string;
  /** Season start year (e.g. 2025 for the 2025-26 season). */
  externalSeason: number;
  /** Vendor-specific metadata (area, emblem, plan, etc.). */
  details: Record<string, unknown>;
}

/**
 * Vendor-agnostic shape for a single match. Mirrors the columns of
 * our `Match` model — the caller is responsible for upserting.
 */
export interface MatchInput {
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Date;
  /**
   * Normalized stage string (one of the 7 `MatchStage` values in
   * `lib/services/stage-mapper.ts`). The adapter is responsible for
   * mapping vendor-specific stage names to our canonical set.
   */
  stage: string;
  /**
   * Normalized status (one of "SCHEDULED" | "GOING" | "FINISHED").
   * The adapter maps vendor-specific status strings (e.g. "TIMED",
   * "IN_PLAY", "FT") onto this 3-value enum.
   */
  status: "SCHEDULED" | "GOING" | "FINISHED";
  homeScore: number | null;
  awayScore: number | null;
  /** Vendor-specific metadata (matchday, group, score breakdown, crests, etc.). */
  details: Record<string, unknown>;
}

/**
 * The contract every auto-syncable vendor implements. Methods are
 * intentionally narrow: just enough to support the cron pipeline and
 * the per-match live-polling endpoint.
 */
export interface VendorAdapter {
  /** The vendor's identifier (matches the `Vendor` union). */
  readonly name: Vendor;

  /**
   * Fetch a single competition's metadata from the vendor.
   *
   * @param externalLeagueId The vendor's league id (e.g. football-data's "PL").
   * @returns A `CompetitionInput` with the display name, season, and
   *          rich `details` JSONB.
   */
  fetchCompetition(externalLeagueId: string): Promise<CompetitionInput>;

  /**
   * Fetch every match in a competition for a given season. Returns
   * the inner matches array (not a paginated envelope).
   *
   * @param externalLeagueId The vendor's league id.
   * @param season           Season start year (e.g. 2025 for the
   *                         2025-26 season). Some vendors (like
   *                         football-data) accept this as a query
   *                         parameter; others ignore it. The
   *                         adapter documents its behavior.
   */
  fetchMatches(externalLeagueId: string, season: number): Promise<MatchInput[]>;

  /**
   * Fetch a single match by its vendor's permanent id. Used by the
   * per-match live-polling endpoint at
   * `app/api/v1/matches/[id]/refresh/route.ts` to refresh one row
   * without re-listing the whole competition.
   *
   * @param externalMatchId The vendor's match id (numeric or string —
   *                        the adapter parses as appropriate).
   */
  fetchMatch(externalMatchId: string): Promise<MatchInput>;
}
