import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getGroupLeaderboard } from "@/lib/services/leaderboard";
import { LeaderboardList } from "@/components/leaderboard/LeaderboardList";
import { PitchBg } from "@/components/football";

export const dynamic = "force-dynamic";

type Params = Promise<{ groupId: string }>;

export default async function LeaderboardPage({ params }: { params: Params }) {
  const { groupId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { competition: { select: { name: true } } },
  });
  if (!group) notFound();

  const isMember = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: user.id, groupId } },
  });
  if (!isMember) redirect("/dashboard");

  const entries = await getGroupLeaderboard(groupId);

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <Link
            href={`/groups/${groupId}`}
            className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
          >
            ← Back to {group.name}
          </Link>
          <p className="micro-tag mb-2">{group.competition.name}</p>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
            Leaderboard
          </h1>
          <p className="text-muted-foreground text-sm leading-6 mb-8">
            Standings for {group.name}. Updates instantly when a match settles.
          </p>

          <LeaderboardList entries={entries} groupId={groupId} />
        </div>
      </main>
    </PitchBg>
  );
}
