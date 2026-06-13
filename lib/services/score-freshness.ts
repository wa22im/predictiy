/**
 * Pure function: compute the next refresh interval for the live
 * polling client, in milliseconds.
 *
 * Return values:
 *   null — stop polling. The match is no longer "live" (FINISHED or
 *          not-yet-started).
 *   number — wait this many ms, then poll again.
 *
 * The function is intentionally simple — the goal is "be reasonably
 * fresh without hammering football-data.org's 10 req/min free tier".
 *
 *   - If the match isn't live (`status !== "GOING"`), don't poll.
 *     Pre-kickoff and post-FINISHED matches are stable.
 *   - If the score just changed, the data we just got is fresh; the
 *     next poll in 30s catches the next goal promptly.
 *   - If the score didn't change, slow down. Two tiers:
 *       - last refresh <3 min old: poll every 2 min. Stable.
 *       - last refresh >=3 min old: poll every 1 min. We've been
 *         quiet too long; be a bit more aggressive so a stuck
 *         client doesn't miss the final 15 minutes.
 *
 * The numbers (30s / 60s / 120s) are conservative — the 5-min
 * per-match rate limit on the server side is the hard cap; the
 * client-side interval is the soft cap that decides when to ASK
 * the server. With ~280 match-cards in a typical feed and a 2-min
 * base interval, the total per-minute load on the server is well
 * under the 10 req/min football-data budget.
 */
export function computeNextRefreshMs(opts: {
  status: "SCHEDULED" | "GOING" | "FINISHED";
  scoreChanged: boolean;
  lastRefreshAgeMs: number;
}): number | null {
  if (opts.status !== "GOING") return null;
  if (opts.scoreChanged) return 30_000;
  if (opts.lastRefreshAgeMs > 180_000) return 60_000;
  return 120_000;
}
