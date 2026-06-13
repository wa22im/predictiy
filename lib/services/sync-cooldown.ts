/**
 * Pure helper that decides whether an admin-triggered sync of a
 * competition is allowed right now, or whether it must be blocked
 * by the 5-minute cooldown guard.
 *
 * Policy (see ISC: isc-cooldown.md):
 *   - If the competition has NO upcoming not-yet-started matches
 *     (i.e. all matches are FINISHED, GOING, or already in the past),
 *     the cooldown is SKIPPED. Admins should be able to retry
 *     immediately for manual data fixes.
 *   - If the competition has upcoming matches AND the last successful
 *     sync was within the cooldown window, BLOCK and return the
 *     remaining ms so the caller can set `Retry-After`.
 *   - Otherwise ALLOW.
 *
 * The function is pure (no I/O, no clock reads) so it is trivially
 * unit-testable and safe to call from both API routes and the cron.
 * The caller is responsible for supplying `now` and the competition
 * state (lastSyncedAt + hasUpcomingMatches) — see the route handler
 * at app/api/v1/admin/competitions/[id]/sync/route.ts for the
 * read-side wiring.
 */

export const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

export type CooldownDecision = {
  allowed: boolean;
  /**
   * Remaining cooldown in milliseconds. `null` when the request is
   * allowed (caller doesn't need to wait).
   */
  retryAfterMs: number | null;
  reason: "OK" | "RATE_LIMITED" | "NO_UPCOMING_MATCHES";
};

export function checkSyncCooldown(opts: {
  lastSyncedAt: Date | null;
  hasUpcomingMatches: boolean;
  now: Date;
}): CooldownDecision {
  if (!opts.hasUpcomingMatches) {
    return {
      allowed: true,
      retryAfterMs: null,
      reason: "NO_UPCOMING_MATCHES",
    };
  }

  if (!opts.lastSyncedAt) {
    return { allowed: true, retryAfterMs: null, reason: "OK" };
  }

  const sinceLastSync = opts.now.getTime() - opts.lastSyncedAt.getTime();
  if (sinceLastSync >= SYNC_COOLDOWN_MS) {
    return { allowed: true, retryAfterMs: null, reason: "OK" };
  }

  return {
    allowed: false,
    retryAfterMs: SYNC_COOLDOWN_MS - sinceLastSync,
    reason: "RATE_LIMITED",
  };
}
