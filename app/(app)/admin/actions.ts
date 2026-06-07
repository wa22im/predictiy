"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import { syncCompetition } from "@/lib/services/competition-sync";
import { CompetitionSyncInput } from "@/lib/validation/admin";
import type { SyncResult } from "@/lib/services/competition-sync";

export type SyncActionResult = {
  ok: boolean;
  result?: SyncResult;
  error?: string;
  issues?: unknown;
};

export async function syncCompetitionAction(
  json: string,
): Promise<SyncActionResult> {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof GuardError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "AUTH_ERROR" };
  }

  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }

  const parsed = CompetitionSyncInput.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", issues: parsed.error.flatten() };
  }

  try {
    const result = await syncCompetition(parsed.data);
    revalidatePath("/admin/hydration");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: "SYNC_FAILED", issues: (e as Error).message };
  }
}
