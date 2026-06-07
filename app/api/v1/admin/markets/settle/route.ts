import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import { settleMarket, SettleError } from "@/lib/services/settle-market";

const Input = z.object({
  marketId: z.string().uuid(),
  correctAnswer: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof GuardError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await settleMarket(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SettleError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "SETTLE_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
