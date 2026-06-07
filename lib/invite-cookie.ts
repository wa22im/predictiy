import "server-only";
import { cookies } from "next/headers";

const NAME = process.env.INVITE_COOKIE_NAME ?? "predicty_invite";
const MAX_AGE = 60 * 60 * 24; // 24 hours

export async function getInviteCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(NAME)?.value ?? null;
}

export async function setInviteCookie(code: string): Promise<void> {
  const store = await cookies();
  store.set(NAME, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function clearInviteCookie(): Promise<void> {
  const store = await cookies();
  store.delete(NAME);
}
