"use server";

import { z } from "zod";

const LoginInput = z.object({
  email: z.email("Invalid email address"),
});

export type LoginResult = {
  ok: boolean;
  error?: string;
};

export async function loginAction(
  formData: FormData,
): Promise<LoginResult> {
  const { createClient } = await import("@/lib/supabase/server");

  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
