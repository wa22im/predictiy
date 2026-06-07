"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const PromoteSchema = z.object({
  targetUserId: z.string().min(1),
  isAdmin: z.boolean(),
});

export type PromoteResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: string };

/**
 * Promote or demote a user. Admin-only. The DB trigger on User.isAdmin
 * mirrors the flag to auth.users.raw_user_meta_data, so middleware picks
 * up the change on the user's next request.
 */
export async function setAdminRole(
  formData: FormData,
): Promise<PromoteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  // Re-check admin from DB, not user_metadata (which may be stale
  // before the trigger fires on the current request).
  const actor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isAdmin: true },
  });
  if (!actor?.isAdmin) {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = PromoteSchema.safeParse({
    targetUserId: formData.get("targetUserId"),
    isAdmin: formData.get("isAdmin") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }

  if (parsed.data.targetUserId === user.id && parsed.data.isAdmin === false) {
    return { ok: false, error: "You cannot demote yourself." };
  }

  await prisma.user.update({
    where: { id: parsed.data.targetUserId },
    data: { isAdmin: parsed.data.isAdmin },
  });

  revalidatePath("/admin/users");

  return { ok: true, isAdmin: parsed.data.isAdmin };
}
