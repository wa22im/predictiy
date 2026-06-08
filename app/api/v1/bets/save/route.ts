import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { saveBetsBatch, SaveBetError } from "@/lib/services/save-bets-batch";

const Input = z.object({
  groupId: z.string().uuid(),
  matchId: z.string().uuid(),
  picks: z.record(z.string().uuid(), z.string().min(1).max(64)),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
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
    const bets = await saveBetsBatch(user.id, parsed.data);
    return NextResponse.json({ bets });
  } catch (e) {
    if (e instanceof SaveBetError) {
      return NextResponse.json(
        { error: e.message, field: e.field },
        { status: e.status },
      );
    }
    return NextResponse.json(
      { error: "SAVE_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
