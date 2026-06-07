"use server";

import { z } from "zod";

const SignupInput = z.object({
  email: z.email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password too long"),
});

export type SignupResult = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
};

export async function signupAction(
  formData: FormData,
): Promise<SignupResult> {
  const { createClient } = await import("@/lib/supabase/server");
  const { getInviteCookie, clearInviteCookie } = await import(
    "@/lib/invite-cookie"
  );
  const { joinGroupByInviteCode } = await import(
    "@/lib/services/join-group"
  );

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return { ok: false, error: "Passwords do not match" };
  }

  const parsed = SignupInput.safeParse({ email, password });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data.session) {
    return {
      ok: false,
      error:
        "Email confirmation is still enabled. Turn it off in Supabase → Authentication → Providers → Email.",
    };
  }

  // If there's a pending invite, hold off on routing to /onboarding so the
  // onboarding action can claim the cookie. Otherwise, /onboarding immediately.
  const inviteCode = await getInviteCookie();
  if (inviteCode) {
    return { ok: true, redirectTo: "/onboarding" };
  }

  return { ok: true, redirectTo: "/onboarding" };
}
