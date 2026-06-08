"use server";

import { z } from "zod";

const Input = z.object({
  groupId: z.string().uuid(),
  matchId: z.string().uuid(),
  picks: z.record(z.string().uuid(), z.string().min(1).max(64)),
});

export type SaveBetsBatchActionResult = {
  ok: boolean;
  error?: string;
  field?: string;
};

export async function saveBetsBatchAction(
  input: z.infer<typeof Input>,
): Promise<SaveBetsBatchActionResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const { saveBetsBatch, SaveBetError } = await import(
    "@/lib/services/save-bets-batch"
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  try {
    await saveBetsBatch(user.id, parsed.data);
    return { ok: true };
  } catch (e) {
    if (e instanceof SaveBetError) {
      return { ok: false, error: e.message, field: e.field };
    }
    return { ok: false, error: (e as Error).message };
  }
}
