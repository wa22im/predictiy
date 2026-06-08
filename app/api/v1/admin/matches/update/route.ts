import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import {
  adminUpdateMatch,
  UpdateMatchError,
} from "@/lib/services/admin-update-match";

/**
 * Strict coercion for optional numeric fields:
 *   - If the field is missing, we want `undefined` (not provided).
 *   - If the field is `null`, we want `null` (caller wants to clear).
 *   - If the field is a number, we want the number.
 *
 * Zod's default `.optional().nullable()` makes the schema accept all
 * three cases — the service then checks `=== undefined` to know which
 * fields to apply.
 */
const nullableInt = z.number().int().min(0).max(50).nullable().optional();

const Input = z.object({
  matchId: z.string().min(1),
  status: z.enum(["SCHEDULED", "GOING", "FINISHED"]).optional(),
  homeScore: nullableInt,
  awayScore: nullableInt,
  homeHtGoals: nullableInt,
  awayHtGoals: nullableInt,
  homePenalties: nullableInt,
  awayPenalties: nullableInt,
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

  const { matchId, ...input } = parsed.data;
  try {
    const result = await adminUpdateMatch(matchId, input);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UpdateMatchError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "UPDATE_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
