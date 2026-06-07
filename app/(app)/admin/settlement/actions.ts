"use server";

import { z } from "zod";

const Input = z.object({
  marketId: z.string().uuid(),
  correctAnswer: z.string().min(1).max(64),
});

export type SettleActionResult = {
  ok: boolean;
  error?: string;
  result?: unknown;
};

export async function settleMarketAction(
  input: z.infer<typeof Input>,
): Promise<SettleActionResult> {
  const { requireAdmin, GuardError } = await import("@/lib/auth/guards");
  const { settleMarket, SettleError } = await import(
    "@/lib/services/settle-market"
  );

  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof GuardError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "AUTH_ERROR" };
  }

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const result = await settleMarket(parsed.data);
    return { ok: true, result };
  } catch (e) {
    if (e instanceof SettleError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: (e as Error).message };
  }
}
