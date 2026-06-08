import { NextResponse } from "next/server";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import {
  syncFootballDataCompetition,
  SyncError,
} from "@/lib/services/sync-football-data-competition";

/**
 * POST /api/v1/admin/competitions/[id]/sync
 *
 * Idempotent sync of a football-data.org competition. Fetches the
 * latest matches from the provider and upserts them into the DB.
 * Re-runs are safe: matches are upserted by `apiMatchId`, markets
 * are upserted on `(matchId, type, title)`, and auto-settle only
 * fires on status *transitions* to FINISHED.
 *
 * Path param `id` is the Competition row's id (UUID).
 *
 * Returns 200 with the sync result on success. 404 if the
 * competition id is unknown, 400 if the competition is not linked
 * to football-data, 401/403 on guard failure, 500 on unexpected
 * error.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof GuardError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  try {
    const result = await syncFootballDataCompetition(id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof SyncError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "SYNC_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
