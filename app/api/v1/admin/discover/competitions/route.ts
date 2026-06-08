import { NextResponse } from "next/server";
import { listCompetitions, FootballDataError } from "@/lib/services/football-data";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/discover/competitions
 *
 * Proxies football-data.org's /v4/competitions endpoint. Hides the API
 * key from the client and enforces the admin guard. The page at
 * /admin/leagues/discover renders the data server-side directly from the
 * client (it doesn't hit this route), so this endpoint is reserved for
 * the future "live filter" UI in a later step.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isAdmin: true },
  });
  if (!actor?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const competitions = await listCompetitions();
    return NextResponse.json({ competitions });
  } catch (e) {
    if (e instanceof FootballDataError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "FETCH_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
