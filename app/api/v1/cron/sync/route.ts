import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  syncFootballDataCompetition,
  type SyncResult,
} from "@/lib/services/sync-football-data-competition";

/**
 * Cron entry point. Vercel Cron config in vercel.json hits this every
 * 7 minutes (see `vercel.json`). We also accept a manual hit from the
 * admin UI or the CLI.
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

  const results: (SyncResult & { competitionId: string; competitionName: string })[] =
    await Promise.all(
      competitions.map((c) =>
        syncFootballDataCompetition(c.id)
          .then((r) => ({ ...r, competitionId: c.id, competitionName: c.name }))
          .catch((e: Error) => ({
            competitionId: c.id,
            competitionName: c.name,
            fetched: 0,
            createdMatches: 0,
            updatedMatches: 0,
            createdMarkets: 0,
            updatedMarkets: 0,
            settledMarkets: 0,
            totalMatches: 0,
            errors: [{ message: e.message }],
          })),
      ),
    );

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
