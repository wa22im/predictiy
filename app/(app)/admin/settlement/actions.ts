"use server";

/**
 * Settlement Hub Server Actions.
 *
 * As of the 7.13 rewrite the per-match form posts directly to
 * `/api/v1/admin/matches/update` (see `app/api/v1/admin/matches/update/route.ts`)
 * via a `fetch` call from `components/admin/SettlementMatchForm.tsx`.
 * No server-side action is invoked from the UI any more.
 *
 * This file is intentionally kept as the per-route actions module
 * (the directory convention is "every app/ route has an adjacent
 * `actions.ts` when server actions are in scope"). If a future
 * Settlement Hub feature needs a server action (e.g. bulk settle
 * across a tournament), add it here.
 */

export type SettlementActionsResult = { ok: true } | { ok: false; error: string };
