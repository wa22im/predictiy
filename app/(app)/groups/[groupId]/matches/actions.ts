"use server";

import { z } from "zod";

const Input = z.object({
  groupId: z.string().uuid(),
  marketId: z.string().uuid(),
  predictedValue: z.string().min(1).max(64),
});

export type SaveBetActionResult = {
  ok: boolean;
  error?: string;
  field?: string;
};

export async function saveBetAction(
  input: z.infer<typeof Input>,
): Promise<SaveBetActionResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const { saveBet, SaveBetError } = await import("@/lib/services/save-bet");

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
    await saveBet(user.id, parsed.data);
    return { ok: true };
  } catch (e) {
    if (e instanceof SaveBetError) {
      return { ok: false, error: e.message, field: e.field };
    }
    return { ok: false, error: (e as Error).message };
  }
}
