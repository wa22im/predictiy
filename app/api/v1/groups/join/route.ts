import { NextResponse } from "next/server";
import { z } from "zod";

const Input = z.object({
  inviteCode: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  const { createClient } = await import("@/lib/supabase/server");
  const { joinGroupByInviteCode } = await import(
    "@/lib/services/join-group"
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "NOT_AUTHENTICATED" },
      { status: 401 },
    );
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

  const group = await joinGroupByInviteCode(user.id, parsed.data.inviteCode);
  if (!group) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ groupId: group.id, groupName: group.name });
}
