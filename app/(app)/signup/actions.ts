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
};

export async function signupAction(
  formData: FormData,
): Promise<SignupResult> {
  const { createClient } = await import("@/lib/supabase/server");

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

  // If "Confirm email" is enabled in Supabase, `data.session` is null and
  // the user must click a link before signing in. We expect it disabled for
  // this dev flow.
  if (!data.session) {
    return {
      ok: false,
      error:
        "Email confirmation is still enabled. Turn it off in Supabase → Authentication → Providers → Email.",
    };
  }

  return { ok: true };
}
