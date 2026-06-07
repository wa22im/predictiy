"use server";

import { z } from "zod";

const LoginInput = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
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

  return { ok: true };
}
