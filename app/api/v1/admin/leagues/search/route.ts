import { NextResponse } from "next/server";
import { z } from "zod";
import { searchLeagues, ApiFootballError } from "@/lib/services/api-football";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const Input = z.object({
  query: z.string().min(1).max(80),
});

export async function POST(request: Request) {
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
    const results = await searchLeagues(parsed.data.query);
    return NextResponse.json({ results });
  } catch (e) {
    if (e instanceof ApiFootballError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "SEARCH_FAILED", message: (e as Error).message },
      { status: 500 },
    );
  }
}
