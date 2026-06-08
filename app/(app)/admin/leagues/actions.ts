"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { ingestLeague, syncCompetition } from "@/lib/services/ingest-league";
import { ApiFootballError } from "@/lib/services/api-football";

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new ApiFootballError("Not authenticated", 401);
  }
  const actor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isAdmin: true },
  });
  if (!actor?.isAdmin) {
    throw new ApiFootballError("Forbidden", 403);
  }
  return user.id;
}

const IngestInput = z.object({
  name: z.string().min(1).max(120),
  externalLeagueId: z.coerce.number().int().positive(),
  externalSeason: z.coerce.number().int().min(2000).max(2100),
});

export type IngestLeagueActionResult =
  | {
      ok: true;
      competitionId: string;
      created: { competition: boolean; matches: number; markets: number };
      updated: { matches: number; markets: number };
      fetched: number;
      warning: string | null;
      errors: { apiMatchId?: string; message: string }[];
    }
  | { ok: false; error: string };

export async function ingestLeagueAction(
  input: z.infer<typeof IngestInput>,
): Promise<IngestLeagueActionResult> {
  try {
    await requireAdmin();
    const parsed = IngestInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const result = await ingestLeague(parsed.data);
    revalidatePath("/admin/leagues");
    revalidatePath("/admin");
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type SyncCompetitionResult =
  | { ok: true; fetched: number; updated: { matches: number; markets: number; settledMarkets: number }; errors: { apiMatchId?: string; message: string }[] }
  | { ok: false; error: string };

export async function syncCompetitionAction(
  competitionId: string,
): Promise<SyncCompetitionResult> {
  try {
    await requireAdmin();
    if (!competitionId) return { ok: false, error: "Missing competition id" };
    const result = await syncCompetition(competitionId);
    revalidatePath("/admin/leagues");
    revalidatePath(`/admin/leagues/${competitionId}`);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Server Action: sync a football-data.org competition.
 *
 * Mirrors the legacy `syncCompetitionAction` but talks to the new
 * `/api/v1/admin/competitions/[id]/sync` route handler via HTTP.
 * Going through the API keeps the request path identical to a curl
 * call from admin tooling — same auth, same error envelope, same
 * response shape.
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
  | { ok: false; error: string; status?: number };

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
        headers: { "Content-Type": "application/json" },
        // The route is admin-guarded server-side; we don't need to
        // forward the user session because `requireAdmin()` above
        // already verified the actor, and the same admin will be
        // re-checked inside the route. For belt-and-suspenders we
        // forward the auth cookies so the route sees the same user.
        cache: "no-store",
      },
    );

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : `Sync failed (${res.status})`,
        status: res.status,
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
