"use server";

import { cookies } from "next/headers";
import type { CreateGroupPayload } from "@/lib/validation/group";

/**
 * Build a Cookie header from the user's session. Server actions
 * that fetch their own API routes need to forward the session
 * cookies so the route's `requireAuth()` can authenticate the
 * request. Without this, the route sees an unauthenticated
 * request and returns 401 NOT_AUTHENTICATED.
 *
 * (Duplicated from `app/(app)/admin/leagues/actions.ts` because
 * the existing helper is local to that file. Each server-action
 * file that calls the public API needs its own. A shared helper
 * in `lib/` would be the obvious follow-up, but the principal
 * prefers explicit duplication for now — the comment above is
 * the same one the admin file carries, and the same fix-lost-
 * and-re-applied history applies.)
 */
async function getCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export async function createGroupAction(input: CreateGroupPayload) {
  const { prisma } = await import("@/lib/prisma");
  const { createClient } = await import("@/lib/supabase/server");
  const { generateInviteCode } = await import("@/lib/invite");
  const { DEFAULT_SCORING_CONFIG } = await import("@/lib/scoring/default-config");
  const { CreateGroupInput } = await import("@/lib/validation/group");

  const parsed = CreateGroupInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  // Generate a unique invite code (retry on collision)
  let inviteCode = generateInviteCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.group.findUnique({
      where: { inviteCode },
      select: { id: true },
    });
    if (!exists) break;
    inviteCode = generateInviteCode();
  }

  const group = await prisma.group.create({
    data: {
      name: parsed.data.name,
      competitionId: parsed.data.competitionId,
      inviteCode,
      scoringConfig: DEFAULT_SCORING_CONFIG,
      // Track the creator in JSONB (no schema migration). The
      // rename endpoint reads this to enforce creator-only
      // permission. Legacy groups have no createdBy and cannot be
      // renamed until a creator is assigned.
      details: { createdBy: user.id },
      members: {
        create: {
          userId: user.id,
        },
      },
    },
  });

  return { ok: true, groupId: group.id };
}

export async function joinByCodeAction(input: { inviteCode: string }):
  Promise<
    | { ok: true; groupId: string; groupName: string }
    | {
        ok: false;
        error: "INVALID_CODE" | "RATE_LIMITED" | "AUTH_REQUIRED" | "NOT_FOUND";
        retryAfterMs?: number;
      }
  > {
  const { headers } = await import("next/headers");
  const { createClient } = await import("@/lib/supabase/server");
  const { joinGroupByInviteCode } = await import("@/lib/services/join-group");
  const { setInviteCookie } = await import("@/lib/invite-cookie");
  const { checkRateLimit, getClientIpFromHeaders } = await import(
    "@/lib/rate-limit"
  );

  const normalized = input.inviteCode.trim().toUpperCase();
  if (normalized.length < 8 || normalized.length > 32) {
    return { ok: false, error: "INVALID_CODE" };
  }

  const h = await headers();
  const ip = getClientIpFromHeaders(h);
  const rl = checkRateLimit(ip, "join-by-code");
  if (!rl.allowed) {
    return { ok: false, error: "RATE_LIMITED", retryAfterMs: rl.retryAfterMs };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    await setInviteCookie(normalized);
    return { ok: false, error: "AUTH_REQUIRED" };
  }

  const group = await joinGroupByInviteCode(user.id, normalized);
  if (!group) {
    return { ok: false, error: "NOT_FOUND" };
  }

  return { ok: true, groupId: group.id, groupName: group.name };
}

/**
 * Server Action: create a pool (Group) tied to either an existing
 * competition or a new custom tournament. Goes through
 * `POST /api/v1/pools` so the auth + validation + error envelope
 * match what a curl call would see. Used by
 * `components/groups/CreatePoolButton.tsx` when the user picks
 * the "Create new custom tournament" mode in the modal.
 *
 * Discriminated union return — the UI switches on `ok` and
 * surfaces the `error` code to the user (mapped to a friendly
 * message in the modal). On success, returns the new group's id
 * + name + the resolved competitionId + competitionName.
 */
export type CreatePoolWithCustomTournamentInput = {
  name: string;
  competitionId?: string;
  newCompetition?: {
    name: string;
    endDate: string;
  };
};

export type CreatePoolWithCustomTournamentResult =
  | {
      ok: true;
      id: string;
      name: string;
      competitionId: string;
      competitionName: string | undefined;
    }
  | { ok: false; error: string };

export async function createPoolWithCustomTournamentAction(
  input: CreatePoolWithCustomTournamentInput,
): Promise<CreatePoolWithCustomTournamentResult> {
  try {
    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/v1/pools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the user's session cookies so the API route can
        // authenticate. The route does its own requireAuth() check.
        "Cookie": await getCookieHeader(),
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error:
          typeof body.error === "string"
            ? body.error
            : `Create failed (${res.status})`,
      };
    }

    return {
      ok: true,
      id: typeof body.id === "string" ? body.id : "",
      name: typeof body.name === "string" ? body.name : input.name,
      competitionId:
        typeof body.competitionId === "string"
          ? body.competitionId
          : input.competitionId ?? "",
      competitionName:
        typeof body.competitionName === "string"
          ? body.competitionName
          : input.newCompetition?.name,
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
    };
  }
}
