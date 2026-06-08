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
