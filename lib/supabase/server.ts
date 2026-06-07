import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Creates a Supabase server client.
 *
 * IMPORTANT: `cookies().set()` is only allowed inside Route Handlers, Server
 * Actions, and Middleware. When this client is used in a Server Component, the
 * `setAll` callback silently no-ops — auth tokens are still refreshed
 * in-memory (and the new session is picked up by the client via the response
 * headers mechanism that `@supabase/ssr` handles automatically). Only call
 * `getUser()` in Server Components; do NOT rely on cookie writes there.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In Server Components cookies() throws on .set() — silently skip.
          // In Route Handlers / Actions this runs normally.
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // Server Component context — skip.
            }
          }
        },
      },
    },
  );
}

export async function getUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}
