"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

const UpdateInput = z.object({
  nickname: z.string().min(1, "Nickname cannot be empty").max(40),
  emoji: z.string().min(1, "Emoji cannot be empty").max(8),
});

export type UpdateProfileResult =
  | { ok: true; user: { id: string; nickname: string; emoji: string } }
  | { ok: false; error: string };

export async function updateProfileAction(
  input: z.infer<typeof UpdateInput>,
): Promise<UpdateProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: parsed.data,
    select: { id: true, nickname: true, emoji: true },
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout"); // refresh navbar (shows nickname/emoji)

  return { ok: true, user: updated };
}
