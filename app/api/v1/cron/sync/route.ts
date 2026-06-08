import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  syncFootballDataCompetition,
  type SyncResult,
} from "@/lib/services/sync-football-data-competition";

/**
 * Cron entry point. As of Phase 10.7 the schedule is owned by a
 * GitHub Actions workflow (`.github/workflows/football-data-sync.yml`)
 * that hits this endpoint on a cron schedule and via `workflow_dispatch`
 * for manual testing. The Vercel cron config (`vercel.json` `crons`
 * array) has been removed. The endpoint is unchanged and still
 * reachable for manual curl testing.
 *
 * Auth: protected by a shared secret in the Authorization header
 * (`Bearer ${CRON_SECRET}`). Returns 401 otherwise. Set CRON_SECRET
 * in the deployment environment; locally, dev hits bypass the check
 * (NODE_ENV !== "production").
 *
 * Pipeline: as of Phase 7.15, the cron iterates every competition
 * with `externalSource = "football-data"` and calls
 * `syncFootballDataCompetition(id)`. The legacy api-football
 * pipeline in `lib/services/ingest-league.ts` is no longer driven
 * from the cron — the api-football pipeline is dead. The response
 * surfaces a `apiFootball.skipped` flag to make that explicit.
 *
 * Per-competition errors are captured into the aggregated `errors`
 * array; the cron never throws. The response includes both the
 * football-data aggregate and the api-football skip notice.
 *
 * Rate-limit note: as of Phase 10.7 the per-competition syncs run
 * sequentially in a `for...of` loop with a 200ms gap between
 * competitions (was `Promise.all`). This stays under
 * football-data.org's 10 req/min free-tier limit when the DB has
 * more than one football-data competition. A single-competition
 * cron still works the same; only the multi-competition case is
 * affected.
 */
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

  const competitions = await prisma.competition.findMany({
    where: { externalSource: "football-data" },
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
      const r = await syncFootballDataCompetition(c.id);
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

  const elapsedMs = Date.now() - start;

  return NextResponse.json({
    elapsedMs,
    footballData: {
      competitions: results.length,
      fetched: results.reduce((a, r) => a + r.fetched, 0),
      createdMatches: results.reduce((a, r) => a + r.createdMatches, 0),
      updatedMatches: results.reduce((a, r) => a + r.updatedMatches, 0),
      settledMarkets: results.reduce((a, r) => a + r.settledMarkets, 0),
      errors: results.flatMap((r) =>
        r.errors.map((e) => ({ competitionId: r.competitionId, ...e })),
      ),
    },
    apiFootball: {
      skipped: true,
      reason: "api football is dead",
    },
  });
}

// Vercel Cron uses POST by default; support both.
export const POST = GET;
