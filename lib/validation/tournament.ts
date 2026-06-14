/**
 * Custom-tournament validation constants — single source of truth.
 *
 * Imported by:
 *   - app/api/v1/admin/competitions/[id]/matches/route.ts
 *     (POST handler — rejects matchIds too close to kickoff)
 *   - app/api/v1/admin/competitions/[id]/matches/[matchId]/route.ts
 *     (DELETE handler — same rule, see MATCH_TOO_CLOSE for clarity)
 *   - components/admin/CustomTournamentMatchManager.tsx
 *     (UI filter — hides matches too close to kickoff from the
 *     picker's default view)
 *
 * Why a shared constant: the server enforces the rule (so the
 * client cannot bypass it) and the UI mirrors it (so the user
 * doesn't see matches they can't actually add). Drift between
 * the two would surface as "I see this match in the picker, but
 * the server rejects it" — bad UX. One constant, two reads.
 */
export const MIN_HOURS_BEFORE_KICKOFF = 1;

export const MIN_MS_BEFORE_KICKOFF =
  MIN_HOURS_BEFORE_KICKOFF * 60 * 60 * 1000;
