import { NextResponse } from "next/server";
import { syncAllCompetitions } from "@/lib/services/ingest-league";

/**
 * Cron entry point. Vercel Cron config in vercel.json hits this every
 * 5 minutes. We also accept a manual hit from the admin UI or the CLI.
 *
 * Auth: protected by a shared secret in the Authorization header
 * (`Bearer ${CRON_SECRET}`). Returns 401 otherwise. Set CRON_SECRET
 * in the deployment environment; locally, dev hits bypass the check
 * (NODE_ENV !== "production").
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
  const results = await syncAllCompetitions();
  const elapsedMs = Date.now() - start;

  const summary = {
    elapsedMs,
    competitions: results.length,
    updatedMatches: results.reduce((a, r) => a + r.updated.matches, 0),
    settledMarkets: results.reduce((a, r) => a + r.updated.settledMarkets, 0),
    errors: results.flatMap((r) => r.errors),
  };

  return NextResponse.json(summary);
}

// Vercel Cron uses POST by default; support both.
export const POST = GET;
