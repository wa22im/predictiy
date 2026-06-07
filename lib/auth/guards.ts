import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export class GuardError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GuardError";
  }
}

/**
 * Server-side guard that asserts the current user has `isAdmin = true`
 * in the public.User table.
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new GuardError(401, "NOT_AUTHENTICATED");
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, isAdmin: true },
  });

  if (!dbUser) {
    throw new GuardError(403, "USER_NOT_FOUND");
  }

  if (!dbUser.isAdmin) {
    throw new GuardError(403, "NOT_ADMIN");
  }

  return { id: dbUser.id, email: dbUser.email };
}

/**
 * Server-side guard that asserts the current user is a member of the group.
 * Throws GuardError(401|403) on failure.
 */
export async function requireGroupMember(groupId: string): Promise<{
  user: { id: string };
  membership: { id: string; joinedAt: Date };
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new GuardError(401, "NOT_AUTHENTICATED");
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId: user.id,
        groupId,
      },
    },
  });

  if (!membership) {
    throw new GuardError(403, "NOT_MEMBER");
  }

  return {
    user: { id: user.id },
    membership: { id: membership.id, joinedAt: membership.joinedAt },
  };
}
