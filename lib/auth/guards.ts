import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side guard that asserts the current user has `isAdmin = true`
 * in the public.User table.
 *
 * Throws an object with `status` so callers can `catch` and convert to
 * a NextResponse. Pattern:
 *   try {
 *     await requireAdmin();
 *   } catch (e) {
 *     return NextResponse.json({ error }, { status: e.status });
 *   }
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

export class GuardError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GuardError";
  }
}
