import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = process.env.INVITE_COOKIE_NAME ?? "predicty_invite";
const MAX_AGE = 60 * 60 * 24; // 24 hours

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ inviteCode: string }> },
) {
  const { inviteCode } = await params;

  const { prisma } = await import("@/lib/prisma");
  const { createClient } = await import("@/lib/supabase/server");
  const { joinGroupByInviteCode } = await import(
    "@/lib/services/join-group"
  );

  const group = await prisma.group.findUnique({
    where: { inviteCode },
    select: { id: true, name: true },
  });

  if (!group) {
    return new NextResponse("Group not found", { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Already signed in — join immediately and clear any stale cookie.
    const joined = await joinGroupByInviteCode(user.id, inviteCode);
    if (!joined) {
      return new NextResponse("Could not join group", { status: 500 });
    }
    const response = NextResponse.redirect(
      new URL(`/groups/${joined.id}`, request.url),
    );
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  // Anonymous — stash the invite code in a cookie and bounce to /login.
  // /signup reads the same cookie via the page-level banner.
  const response = NextResponse.redirect(
    new URL("/login?invited=1", request.url),
  );
  response.cookies.set(COOKIE_NAME, inviteCode, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
  return response;
}
