import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import {
  clearInviteCookie,
  setInviteCookie,
} from "@/lib/invite-cookie";
import { joinGroupByInviteCode } from "@/lib/services/join-group";

type Params = Promise<{ inviteCode: string }>;

export default async function JoinPage({ params }: { params: Params }) {
  const { inviteCode } = await params;

  const group = await prisma.group.findUnique({
    where: { inviteCode },
    select: { id: true, name: true },
  });

  if (!group) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Already authenticated — join immediately and clear any stale cookie.
    const joined = await joinGroupByInviteCode(user.id, inviteCode);
    await clearInviteCookie();
    if (joined) {
      redirect(`/groups/${joined.id}`);
    }
  }

  // Unauthenticated — stash the invite code in a cookie and bounce to /login.
  // /signup also reads the same cookie via the page-level banner.
  await setInviteCookie(inviteCode);
  redirect(`/login?invited=1`);
}
