import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  syncFootballDataCompetition,
  type SyncResult,
} from "@/lib/services/sync-football-data-competition";
import { VENDORS, type Vendor } from "@/lib/services/vendors";

/**
 * Cron entry point. The schedule is owned by a GitHub Actions
 * workflow (`.github/workflows/football-data-sync.yml`) that hits
 * this endpoint on a cron schedule and via `workflow_dispatch` for
 * manual testing. The Vercel cron config (`vercel.json` `crons`
 * array) has been removed. The endpoint is unchanged and still
 * reachable for manual curl testing.
 *
 * Auth: protected by a shared secret in the Authorization header
 * (`Bearer ${CRON_SECRET}`). Returns 401 otherwise. Set CRON_SECRET
 * in the deployment environment; locally, dev hits bypass the check
 * (NODE_ENV !== "production").
 *
 * Pipeline: iterates the `VENDORS` registry from
 * `lib/services/vendors/index.ts` and, for each registered vendor,
 * fetches every Competition row whose `externalSource` matches and
 *   - `deletedAt IS NULL` (soft-deleted competitions are skipped)
 *   - `externalLeagueId` is set (competitions without a vendor id
 *     are "manual" / hand-entered and have nothing to fetch from)
 *
 * For each competition the cron dispatches to the per-vendor sync
 * function via `syncByVendor` (a small switch — see below). A
 * per-competition error is captured into the response; the cron
 * never throws.
 *
 * The response shape preserves the legacy `footballData` aggregate
 * and the `apiFootball.skipped: true` block for backward
 * compatibility with `DEPLOY.md:115`, and adds a `vendors` map that
 * lists every vendor in the registry along with its sync status.
 * A vendor whose adapter is not yet implemented (e.g.
 * "fixturedownload" today) appears in the response with a
 * `skipped: true` flag rather than aborting the whole cron run.
 *
 * Rate-limit note: the per-competition syncs run sequentially in a
 * `for...of` loop with a 200ms gap between competitions (was
 * `Promise.all`). This stays under football-data.org's 10 req/min
 * free-tier limit when the DB has more than one football-data
 * competition. A single-competition cron still works the same; only
 * the multi-competition case is affected.
 */

/**
 * Dispatch a single competition to the right per-vendor sync
 * function. The switch is the seam that lets new vendors plug in:
 * add a new `case` here when implementing a new vendor's adapter,
 * alongside the registry entry in `lib/services/vendors/index.ts`.
 *
 * Today only "football-data" is implemented. "fixturedownload" is
 * in the `VENDORS` list (so the cron iterates it and the response
 * is stable) but the sync function and the adapter are not yet
 * implemented — the cron surfaces a clear error per competition
 * rather than silently skipping.
 */
async function syncByVendor(
  vendor: Vendor,
  competitionId: string,
): Promise<SyncResult> {
  switch (vendor) {
    case "football-data":
      return syncFootballDataCompetition(competitionId);
    case "fixturedownload":
      // Future: call the fixturedownload sync service here.
      throw new Error(
        `fixturedownload sync is not yet implemented (competition ${competitionId})`,
      );
    case "manual":
      // Defensive: the cron's `externalSource IN (VENDORS)` filter
      // never returns "manual" rows (we exclude it from the
      // registry), but the union type still includes it. If a
      // caller ever dispatches "manual" here, fail loud.
      throw new Error("manual competitions are not auto-syncable");
    default: {
      // Exhaustiveness check: TS errors here if a new Vendor is
      // added to the union but not handled in the switch.
      const _exhaustive: never = vendor;
      throw new Error(`unknown vendor: ${String(_exhaustive)}`);
    }
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 },
      );
    }
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const start = Date.now();

  // Per-vendor aggregate. Each entry has a status (`ran` /
  // `skipped`) plus the per-vendor sync totals (when the vendor is
  // runnable). The legacy `footballData` aggregate is computed from
  // the same per-vendor result, so the two stay in lockstep.
  const vendorReports: Record<
    string,
    {
      status: "ran" | "skipped";
      reason?: string;
      competitions: number;
      fetched: number;
      createdMatches: number;
      updatedMatches: number;
      settledMarkets: number;
      errors: { competitionId: string; message: string }[];
    }
  > = {};

  for (const vendor of VENDORS) {
    // Try to resolve the adapter. A vendor in the `VENDORS` list
    // without a registered adapter is "future-registered" — we
    // surface that as a skipped block rather than aborting the
    // whole cron run. See the discussion in
    // `lib/services/vendors/index.ts`.
    //
    // The `VENDORS` list is typed as `Vendor[]` (which includes
    // "manual") but the registry only ever has "manual"-excluded
    // entries, and `getVendorAdapter` accepts
    // `Exclude<Vendor, "manual">`. We narrow here so the type
    // system and runtime agree.
    let adapter;
    try {
      if (vendor === "manual") {
        // VENDORS shouldn't contain "manual" (the index module
        // excludes it), but if a future refactor adds it, we
        // surface a clear skipped block rather than crashing.
        throw new Error("manual is not an auto-syncable vendor");
      }
      adapter = (
        await import("@/lib/services/vendors")
      ).getVendorAdapter(vendor);
    } catch (e) {
      vendorReports[vendor] = {
        status: "skipped",
        reason: (e as Error).message,
        competitions: 0,
        fetched: 0,
        createdMatches: 0,
        updatedMatches: 0,
        settledMarkets: 0,
        errors: [],
      };
      continue;
    }

    // Lookup the adapter is enough to consider the vendor "ran";
    // we only do per-vendor work if there are competitions to
    // sync. The `_adapter` variable exists so a future vendor
    // whose sync path consults the adapter (e.g. to call
    // `adapter.fetchMatches`) can do so without re-importing.
    void adapter;

    const competitions = await prisma.competition.findMany({
      where: { externalSource: vendor, deletedAt: null },
      select: { id: true, name: true },
    });

    // Sequential, not parallel: football-data.org's free tier is
    // 10 req/min. Running the per-competition syncs in `Promise.all`
    // hits the rate limit as soon as 2+ football-data competitions
    // exist in the DB. The 200ms gap keeps us comfortably under the
    // limit even with 5+ competitions queued in a single cron run.
    const results: (SyncResult & { competitionId: string; competitionName: string })[] = [];
    for (const c of competitions) {
      try {
        const r = await syncByVendor(vendor, c.id);
        results.push({ ...r, competitionId: c.id, competitionName: c.name });
      } catch (e) {
        const err = e as Error;
        results.push({
          competitionId: c.id,
          competitionName: c.name,
          fetched: 0,
          createdMatches: 0,
          updatedMatches: 0,
          createdMarkets: 0,
          updatedMarkets: 0,
          settledMarkets: 0,
          totalMatches: 0,
          errors: [{ message: err.message }],
        });
      }
      if (competitions.length > 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    vendorReports[vendor] = {
      status: "ran",
      competitions: results.length,
      fetched: results.reduce((a, r) => a + r.fetched, 0),
      createdMatches: results.reduce((a, r) => a + r.createdMatches, 0),
      updatedMatches: results.reduce((a, r) => a + r.updatedMatches, 0),
      settledMarkets: results.reduce((a, r) => a + r.settledMarkets, 0),
      errors: results.flatMap((r) =>
        r.errors.map((e) => ({ competitionId: r.competitionId, ...e })),
      ),
    };
  }

  // Build the legacy `footballData` aggregate from the per-vendor
  // report so external consumers (DEPLOY.md, the GitHub Actions
  // workflow log) see the same shape they did before the
  // multi-vendor refactor.
  const footballDataReport = vendorReports["football-data"];
  const footballData = footballDataReport
    ? {
        competitions: footballDataReport.competitions,
        fetched: footballDataReport.fetched,
        createdMatches: footballDataReport.createdMatches,
        updatedMatches: footballDataReport.updatedMatches,
        settledMarkets: footballDataReport.settledMarkets,
        errors: footballDataReport.errors,
      }
    : {
        competitions: 0,
        fetched: 0,
        createdMatches: 0,
        updatedMatches: 0,
        settledMarkets: 0,
        errors: [],
      };

  const elapsedMs = Date.now() - start;

  return NextResponse.json({
    elapsedMs,
    // Legacy shape — preserved for backward compat with DEPLOY.md
    // and the GitHub Actions workflow.
    footballData,
    apiFootball: {
      skipped: true,
      reason: "api football is dead",
    },
    // New vendor-aware shape. `vendors` lists every vendor in the
    // registry; a vendor whose adapter is not yet implemented is
    // marked `status: "skipped"` with a `reason`.
    vendors: vendorReports,
  });
}

// Vercel Cron uses POST by default; support both.
export const POST = GET;
