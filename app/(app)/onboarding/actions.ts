"use server";

import { z } from "zod";

const OnboardingInput = z.object({
  nickname: z
    .string()
    .min(2, "Nickname must be at least 2 characters")
    .max(24, "Nickname must be 24 characters or fewer")
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, and underscores only"),
  emoji: z.string().min(1),
});

export type OnboardingResult = {
  ok: boolean;
  error?: string;
  field?: "nickname" | "emoji";
};

export async function completeOnboardingAction(
  formData: FormData,
): Promise<OnboardingResult | void> {
  const { createClient } = await import("@/lib/supabase/server");
  const { prisma } = await import("@/lib/prisma");
  const { redirect } = await import("next/navigation");
  const { getInviteCookie, clearInviteCookie } = await import(
    "@/lib/invite-cookie"
  );
  const { joinGroupByInviteCode } = await import(
    "@/lib/services/join-group"
  );

  const parsed = OnboardingInput.safeParse({
    nickname: formData.get("nickname"),
    emoji: formData.get("emoji"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Invalid input",
      field: issue?.path[0] as "nickname" | "emoji" | undefined,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  const existing = await prisma.user.findFirst({
    where: {
      nickname: parsed.data.nickname,
      NOT: { id: user.id },
    },
    select: { id: true },
  });

  if (existing) {
    return {
      ok: false,
      error: "That nickname is taken",
      field: "nickname",
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      nickname: parsed.data.nickname,
      emoji: parsed.data.emoji,
    },
  });

  await supabase.auth.updateUser({
    data: {
      nickname: parsed.data.nickname,
      emoji: parsed.data.emoji,
    },
  });

  // Consume any pending invite and route the user straight to the group.
  const inviteCode = await getInviteCookie();
  if (inviteCode) {
    const group = await joinGroupByInviteCode(user.id, inviteCode);
    await clearInviteCookie();
    if (group) {
      redirect(`/groups/${group.id}`);
    }
  }

  redirect("/dashboard");
}
