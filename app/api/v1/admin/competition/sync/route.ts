import { NextResponse } from "next/server";
import { CompetitionSyncInput } from "@/lib/validation/admin";
import { syncCompetition } from "@/lib/services/competition-sync";
import { requireAdmin, GuardError } from "@/lib/auth/guards";

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

  const parsed = CompetitionSyncInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await syncCompetition(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "SYNC_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
