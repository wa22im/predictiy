"use server";

import { z } from "zod";

const LoginInput = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginResult = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
};

export async function loginAction(
  formData: FormData,
): Promise<LoginResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const { getInviteCookie, clearInviteCookie } = await import(
    "@/lib/invite-cookie"
  );
  const { joinGroupByInviteCode } = await import(
    "@/lib/services/join-group"
  );

  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // Consume any pending invite — for onboarded users, this routes them
  // straight to the joined group. For new users, the invite stays in the
  // cookie and is consumed by the onboarding action.
  const inviteCode = await getInviteCookie();
  if (inviteCode) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const group = await joinGroupByInviteCode(user.id, inviteCode);
      if (group) {
        await clearInviteCookie();
        return { ok: true, redirectTo: `/groups/${group.id}` };
      }
    }
  }

  return { ok: true, redirectTo: "/dashboard" };
}
