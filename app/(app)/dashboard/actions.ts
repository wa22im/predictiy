"use server";

import type { CreateGroupPayload } from "@/lib/validation/group";

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
      members: {
        create: {
          userId: user.id,
        },
      },
    },
  });

  return { ok: true, groupId: group.id };
}
