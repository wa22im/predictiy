"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * Build a Cookie header from the user's session. Server actions that
 * fetch their own API routes need to forward the session cookies so
 * the route's `requireAdmin()` can authenticate the request. Without
 * this, the route sees an unauthenticated request and returns 401
 * NOT_AUTHENTICATED — which is the exact error the principal hit.
 *
 * Why we fetch the API route at all instead of calling the service
 * directly: the action's contract is "go through the public API so
 * curl and the UI share the same auth + validation + error envelope."
 * The cookie forwarding is what makes that contract actually work.
 *
 * IMPORTANT: this fix has been lost and re-applied twice in the past
 * few sessions. If you remove it again, document the reason or this
 * comment will be wrong. The principal relies on sync working.
 */
async function getCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  const actor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isAdmin: true },
  });
  if (!actor?.isAdmin) {
    throw new Error("Forbidden");
  }
  return user.id;
}

/**
 * Server Action: sync a football-data.org competition.
 *
 * Goes through the `/api/v1/admin/competitions/[id]/sync` route
 * handler via HTTP. Going through the API keeps the request path
 * identical to a curl call from admin tooling — same auth, same
 * error envelope, same response shape.
 *
 * Returns a discriminated union so the client can render a richer
 * success message (new matches, settled markets) without the
 * caller needing to interpret raw fetch errors.
 */
export type SyncFootballDataCompetitionResult =
  | {
      ok: true;
      fetched: number;
      createdMatches: number;
      updatedMatches: number;
      createdMarkets: number;
      updatedMarkets: number;
      settledMarkets: number;
      totalMatches: number;
    }
  | { ok: false; error: string; status?: number; retryAfterMs?: number };

export async function syncFootballDataCompetitionAction(
  competitionId: string,
): Promise<SyncFootballDataCompetitionResult> {
  try {
    await requireAdmin();
    if (!competitionId) {
      return { ok: false, error: "Missing competition id" };
    }

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(
      `${baseUrl}/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Forward the user's session cookies so the API route can authenticate.
          // The route does its own requireAdmin() check.
          "Cookie": await getCookieHeader(),
        },
        cache: "no-store",
      },
    );

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const retryAfterMs =
        typeof body.retryAfterMs === "number" ? body.retryAfterMs : undefined;
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : `Sync failed (${res.status})`,
        status: res.status,
        retryAfterMs,
      };
    }

  revalidatePath("/admin/leagues");
  revalidatePath(`/admin/leagues/${competitionId}`);
  return {
    ok: true,
    fetched: Number(body.fetched ?? 0),
    createdMatches: Number(body.createdMatches ?? 0),
    updatedMatches: Number(body.updatedMatches ?? 0),
    createdMarkets: Number(body.createdMarkets ?? 0),
    updatedMarkets: Number(body.updatedMarkets ?? 0),
    settledMarkets: Number(body.settledMarkets ?? 0),
    totalMatches: Number(body.totalMatches ?? 0),
  };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      status: (e as { status?: number }).status,
    };
  }
}

/**
 * Server Action: PATCH a competition's editable fields.
 *
 * Mirrors `syncFootballDataCompetitionAction`: goes through the
 * public API route so the auth + validation + error envelope match
 * exactly what a curl call would see. The set of editable fields is
 * the same as the route's zod schema — admin must use the DB
 * directly to change other columns.
 */
export type PatchCompetitionInput = {
  name?: string;
  endDate?: string | null;
  externalLeagueId?: string | null;
  externalSeason?: number | null;
  details?: Record<string, unknown> | null;
};

export type PatchCompetitionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; status?: number };

export async function patchCompetitionAction(
  competitionId: string,
  input: PatchCompetitionInput,
): Promise<PatchCompetitionResult> {
  try {
    await requireAdmin();
    if (!competitionId) {
      return { ok: false, error: "Missing competition id" };
    }

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(
      `${baseUrl}/api/v1/admin/competitions/${encodeURIComponent(competitionId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          // Forward the user's session cookies so the API route can authenticate.
          // The route does its own requireAdmin() check.
          "Cookie": await getCookieHeader(),
        },
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : `Update failed (${res.status})`,
        status: res.status,
      };
    }

    revalidatePath("/admin/leagues");
    revalidatePath(`/admin/leagues/${competitionId}`);
    const id = typeof body.id === "string" ? body.id : competitionId;
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      status: (e as { status?: number }).status,
    };
  }
}

/**
 * Server Action: soft-delete a competition. Stamps `deletedAt =
 * now()`. Idempotent — re-running on an already-deleted row returns
 * success without changing anything.
 */
export type DeleteCompetitionResult =
  | { ok: true; id: string; deletedAt: string }
  | { ok: false; error: string; status?: number };

export async function deleteCompetitionAction(
  competitionId: string,
): Promise<DeleteCompetitionResult> {
  try {
    await requireAdmin();
    if (!competitionId) {
      return { ok: false, error: "Missing competition id" };
    }

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(
      `${baseUrl}/api/v1/admin/competitions/${encodeURIComponent(competitionId)}`,
      {
        method: "DELETE",
        headers: {
          // Forward the user's session cookies so the API route can authenticate.
          // The route does its own requireAdmin() check.
          "Cookie": await getCookieHeader(),
        },
        cache: "no-store",
      },
    );

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : `Delete failed (${res.status})`,
        status: res.status,
      };
    }

    revalidatePath("/admin/leagues");
    revalidatePath(`/admin/leagues/${competitionId}`);
    return {
      ok: true,
      id: typeof body.id === "string" ? body.id : competitionId,
      deletedAt:
        typeof body.deletedAt === "string" ? body.deletedAt : new Date().toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      status: (e as { status?: number }).status,
    };
  }
}

/**
 * Server Action: create a custom (hand-built) tournament. The new
 * competition is born with `externalSource = null` so the cron never
 * auto-syncs it. The admin then adds matches via
 * `addMatchesToCompetitionAction` (which writes to the
 * CompetitionMatch join table).
 *
 * Goes through `POST /api/v1/admin/competitions` for the same reason
 * the other actions go through the API: shared auth + validation +
 * error envelope with curl. The Cookie header is forwarded so the
 * route's `requireAdmin()` can authenticate the request.
 */
export type CreateCustomCompetitionInput = {
  name: string;
  endDate?: string;
};

export type CreateCustomCompetitionResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string; status?: number };

export async function createCustomCompetitionAction(
  input: CreateCustomCompetitionInput,
): Promise<CreateCustomCompetitionResult> {
  try {
    await requireAdmin();
    if (!input.name) {
      return { ok: false, error: "Missing competition name" };
    }

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/v1/admin/competitions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the user's session cookies so the API route can
        // authenticate. The route does its own requireAdmin() check.
        "Cookie": await getCookieHeader(),
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error:
          typeof body.error === "string" ? body.error : `Create failed (${res.status})`,
        status: res.status,
      };
    }

    revalidatePath("/admin/leagues");
    return {
      ok: true,
      id: typeof body.id === "string" ? body.id : "",
      name: typeof body.name === "string" ? body.name : input.name,
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      status: (e as { status?: number }).status,
    };
  }
}

/**
 * Server Action: add matches to a custom tournament. Goes through
 * `POST /api/v1/admin/competitions/[id]/matches` so the auth +
 * validation + idempotency contract match what a curl call would see.
 */
export type AddMatchesResult =
  | { ok: true; added: number; requested: number }
  | { ok: false; error: string; status?: number };

export async function addMatchesToCompetitionAction(
  competitionId: string,
  matchIds: string[],
): Promise<AddMatchesResult> {
  try {
    await requireAdmin();
    if (!competitionId) {
      return { ok: false, error: "Missing competition id" };
    }
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return { ok: false, error: "matchIds must be a non-empty array" };
    }

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(
      `${baseUrl}/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/matches`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": await getCookieHeader(),
        },
        body: JSON.stringify({ matchIds }),
        cache: "no-store",
      },
    );

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error:
          typeof body.error === "string" ? body.error : `Add matches failed (${res.status})`,
        status: res.status,
      };
    }

    revalidatePath(`/admin/leagues/${competitionId}`);
    revalidatePath("/admin/leagues");
    return {
      ok: true,
      added: Number(body.added ?? 0),
      requested: Number(body.requested ?? matchIds.length),
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      status: (e as { status?: number }).status,
    };
  }
}

/**
 * Server Action: remove a match from a custom tournament. The API
 * route enforces "match has not been played" — this wrapper just
 * forwards the response. On `MATCH_ALREADY_PLAYED` the UI surfaces
 * a precise error message.
 */
export type RemoveMatchResult =
  | { ok: true; removed: boolean }
  | { ok: false; error: string; status?: number };

export async function removeMatchFromCompetitionAction(
  competitionId: string,
  matchId: string,
): Promise<RemoveMatchResult> {
  try {
    await requireAdmin();
    if (!competitionId) {
      return { ok: false, error: "Missing competition id" };
    }
    if (!matchId) {
      return { ok: false, error: "Missing match id" };
    }

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(
      `${baseUrl}/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/matches/${encodeURIComponent(matchId)}`,
      {
        method: "DELETE",
        headers: {
          "Cookie": await getCookieHeader(),
        },
        cache: "no-store",
      },
    );

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error:
          typeof body.error === "string"
            ? body.error
            : `Remove match failed (${res.status})`,
        status: res.status,
      };
    }

    revalidatePath(`/admin/leagues/${competitionId}`);
    revalidatePath("/admin/leagues");
    return { ok: true, removed: body.removed === true };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      status: (e as { status?: number }).status,
    };
  }
}
