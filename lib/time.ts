/**
 * Time helpers for the 5-minute save lockdown and the view-lock mask.
 * Pure functions only — usable from server and client components.
 */

const LOCKDOWN_MINUTES = parseInt(process.env.LOCKDOWN_MINUTES ?? "5", 10);
export const LOCKDOWN_MS = LOCKDOWN_MINUTES * 60 * 1000;

/** True if `now` is at or past `kickoffTime - LOCKDOWN_MS` (saves blocked). */
export function isLocked(
  match: { kickoffTime: Date },
  now: Date = new Date(),
): boolean {
  return now.getTime() >= match.kickoffTime.getTime() - LOCKDOWN_MS;
}

/**
 * True while the match hasn't started. While true, foreign UserBets
 * are masked to "🔒" in the feed. Distinct from the 5-minute save
 * lockdown — once a match is past kickoff, bets become visible even
 * if the match hasn't been settled yet.
 */
export function isViewLocked(
  match: { kickoffTime: Date },
  now: Date = new Date(),
): boolean {
  return now.getTime() < match.kickoffTime.getTime();
}

/** Milliseconds until the save-lock cutoff. 0 if already locked. */
export function timeUntilLock(
  match: { kickoffTime: Date },
  now: Date = new Date(),
): number {
  const lockAt = match.kickoffTime.getTime() - LOCKDOWN_MS;
  return Math.max(0, lockAt - now.getTime());
}

/** Compact human-readable countdown: "3d 4h", "2h 15m", "12m 30s", "5s". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Locked";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a kickoff timestamp in UTC.
 * Examples:
 *   "Mon 14 Jun, 20:00 UTC"
 *   "Sun 12 Jul, 02:30 UTC"
 *
 * Pure, deterministic, locale-stable. Use this anywhere we want a
 * single canonical display of a UTC time.
 */
export function formatUtc(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date}, ${time} UTC`;
}
