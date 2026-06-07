import { prisma } from "@/lib/prisma";

/**
 * Idempotent: re-joining the same group is a no-op (upsert).
 * Returns the group on success, null if the inviteCode doesn't match any group.
 */
export async function joinGroupByInviteCode(
  userId: string,
  inviteCode: string,
): Promise<{ id: string; name: string } | null> {
  const group = await prisma.group.findUnique({
    where: { inviteCode },
    select: { id: true, name: true },
  });

  if (!group) return null;

  await prisma.groupMember.upsert({
    where: {
      userId_groupId: {
        userId,
        groupId: group.id,
      },
    },
    update: {},
    create: {
      userId,
      groupId: group.id,
    },
  });

  return group;
}
