import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getMatchById, type Match as FootballDataMatch } from "@/lib/services/football-data";
import { computeNextRefreshMs } from "@/lib/services/score-freshness";

const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * POST /api/v1/matches/[id]/refresh
 *
 * User-driven live-polling endpoint. The client (MatchCard polling
 * effect) calls this on a schedule computed by `computeNextRefreshMs`
 * to get the latest score + status for one match.
 *
 * Auth: any authenticated user. The endpoint is read-mostly (writes
 * are limited to updating the cached score on the match row), so it
 * doesn't need to be admin-only. The 5-min per-match rate limit
 * keeps abuse bounded — a single user can only trigger one
 * football-data.org call per match every 5 minutes.
 *
 * Responses:
 *   200 — JSON body with { homeScore, awayScore, status, scoreChanged,
 *                          cached, nextRefreshMs, [error], [reason] }
 *   401 — not authenticated
 *   404 — match id unknown
 *   500 — unexpected (uncaught) error
 *
 * The response always carries the current state from the DB (either
 * fresh or cached) so the client can update its UI from a single
 * round-trip. The `cached` flag distinguishes a fresh read from a
 * rate-limited one; `scoreChanged` is true iff the just-returned
 * scores differ from what the row had when the user polled last.
 *
 * The `nextRefreshMs` value is computed by `computeNextRefreshMs`
 * using the same inputs the client uses to schedule its next poll
 * — keeping the formula in one place.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  // 2. Read the match row + its parent competition's `externalSource`.
  //    The match itself doesn't carry the source — it inherits from
  //    the competition. We need the source to know whether to call
  //    football-data, the legacy api-football pipeline, or neither.
  const match = await prisma.match.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeHtGoals: true,
      awayHtGoals: true,
      homePenalties: true,
      awayPenalties: true,
      kickoffTime: true,
      apiMatchId: true,
      scoreLastSyncedAt: true,
      competition: { select: { externalSource: true } },
    },
  });
  if (!match) {
    return NextResponse.json({ error: "MATCH_NOT_FOUND" }, { status: 404 });
  }

  const now = new Date();
  const kickoffMs = match.kickoffTime.getTime();
  const hasStarted = kickoffMs <= now.getTime();

  // 3. Pre-kickoff: don't poll.
  if (!hasStarted) {
    return NextResponse.json({
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      nextRefreshMs: null,
      reason: "NOT_STARTED",
    });
  }

  // 4. FINISHED: don't poll.
  if (match.status === "FINISHED") {
    return NextResponse.json({
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      nextRefreshMs: null,
    });
  }

  // 5. Rate-limit guard: 5-min per match. Cached data is fresh enough.
  const lastSync = match.scoreLastSyncedAt;
  const sinceLastSync = lastSync ? now.getTime() - lastSync.getTime() : Infinity;
  if (sinceLastSync < MIN_SYNC_INTERVAL_MS) {
    return NextResponse.json({
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      scoreChanged: false,
      cached: true,
      nextRefreshMs: computeNextRefreshMs({
        status: match.status,
        scoreChanged: false,
        lastRefreshAgeMs: sinceLastSync,
      }),
    });
  }

  // 6. Source guard: only football-data is wired up.
  if (match.competition.externalSource !== "football-data") {
    return NextResponse.json({
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      nextRefreshMs: null,
      reason: "UNSUPPORTED_SOURCE",
    });
  }

  // 7. Hit football-data for this one match.
  let fresh: FootballDataMatch;
  try {
    fresh = await getMatchById(match.apiMatchId);
  } catch {
    return NextResponse.json({
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      nextRefreshMs: computeNextRefreshMs({
        status: match.status,
        scoreChanged: false,
        lastRefreshAgeMs: sinceLastSync,
      }),
      error: "FETCH_FAILED",
    });
  }

  const newStatus = mapStatus(fresh.status);
  const newHomeScore = fresh.score.fullTime.home;
  const newAwayScore = fresh.score.fullTime.away;

  const scoreChanged =
    newHomeScore !== match.homeScore ||
    newAwayScore !== match.awayScore ||
    newStatus !== match.status;

  await prisma.match.update({
    where: { id: match.id },
    data: {
      status: newStatus,
      homeScore: newHomeScore,
      awayScore: newAwayScore,
      homeHtGoals: fresh.score.halfTime.home,
      awayHtGoals: fresh.score.halfTime.away,
      // football-data.org's `score.penalties` is the shootout result
      // (post-match), not in-game penalties. We never write it.
      homePenalties: match.homePenalties,
      awayPenalties: match.awayPenalties,
      scoreLastSyncedAt: now,
    },
  });

  return NextResponse.json({
    homeScore: newHomeScore,
    awayScore: newAwayScore,
    status: newStatus,
    scoreChanged,
    cached: false,
    nextRefreshMs: computeNextRefreshMs({
      status: newStatus,
      scoreChanged,
      lastRefreshAgeMs: 0,
    }),
  });
}

/**
 * Map football-data.org's free-form status string to our 3-value
 * enum. Mirrors the mapping in
 * `lib/services/apply-football-data-matches.ts` so the two
 * code paths stay coherent.
 */
function mapStatus(
  status: FootballDataMatch["status"],
): "SCHEDULED" | "GOING" | "FINISHED" {
  switch (status) {
    case "FINISHED":
    case "AWARDED":
      return "FINISHED";
    case "IN_PLAY":
    case "PAUSED":
      return "GOING";
    case "SCHEDULED":
    case "TIMED":
    case "CANCELLED":
    case "POSTPONED":
    default:
      return "SCHEDULED";
  }
}
