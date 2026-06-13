/**
 * Parse a YYYY-MM-DD end-date string from an external provider into
 * a Date. Returns `undefined` on any failure (null, undefined, empty
 * string, malformed date). Callers pass the result into Prisma
 * upserts — `undefined` means "leave the column alone" (Prisma
 * convention), so a transient API glitch never clobbers a previously
 * stored end date.
 *
 * The football-data.org and api-football.com feeds both surface
 * endDate as a calendar date string (no time component). We parse
 * with `new Date(s)` which yields UTC midnight — that's the correct
 * boundary for "the tournament ended on day X" semantics; the
 * dashboard's `endDate > now` comparison treats it as "still active
 * until end of day X".
 */
export function parseCompetitionEndDate(
  input: unknown,
): Date | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  return d;
}
