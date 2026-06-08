import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import {
  onboardCompetition,
  OnboardError,
  FootballDataError,
} from "@/lib/services/onboard-competition";

const Input = z.object({
  code: z.string().min(1).max(64),
  displayName: z.string().min(1).max(120).optional(),
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
    const result = await onboardCompetition(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof OnboardError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof FootballDataError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "ONBOARD_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
