import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Goal, Trophy } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { ShareInvite } from "@/components/groups/ShareInvite";
import { LeaderboardList } from "@/components/leaderboard/LeaderboardList";
import { getGroupLeaderboard } from "@/lib/services/leaderboard";
import { PitchBg } from "@/components/football";

export const dynamic = "force-dynamic";

type Params = Promise<{ groupId: string }>;

export default async function GroupPage({ params }: { params: Params }) {
  const { groupId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      competition: { select: { name: true } },
      members: {
        include: {
          user: {
            select: { id: true, nickname: true, emoji: true },
          },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!group) notFound();

  // Membership check
  const isMember = group.members.some((m) => m.userId === user.id);
  if (!isMember) {
    redirect("/dashboard");
  }

  // Top-5 leaderboard preview for the landing page. The full list
  // lives on /groups/[groupId]/leaderboard; the preview gives a
  // quick-glance summary without leaving the landing page.
  const entries = await getGroupLeaderboard(groupId);

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-4xl mx-auto">

          <div className="mb-8">
             <h1 className="font-display sm:text-4xl font-bold tracking-tight ">
               {group.name}
             </h1>
             <p className="text-muted-foreground font-display tracking-tight">
               {group.competition.name}
             </p>
             <p className="text-muted-foreground text-sm mt-2">
               {group.members.length}{" "}
               {group.members.length === 1 ? "member" : "members"}
             </p>
          </div>

          <div className="mb-8">
            <ShareInvite inviteCode={group.inviteCode} />
          </div>

          {/* Action buttons: stacked column, matching ShareInvite collapsed-summary size */}
          <div className="space-y-2 mb-8">
            <Link
              href={`/groups/${groupId}/matches`}
              className="pitch-card p-4 flex items-center gap-3 hover:bg-secondary/40 transition-colors"
            >
              <Goal aria-hidden="true" className="h-5 w-5 text-accent" />
              <span className="font-display font-bold tracking-tight">Matches</span>
              <span aria-hidden="true" className="ml-auto text-muted-foreground text-sm">→</span>
            </Link>
            <Link
              href={`/groups/${groupId}/leaderboard`}
              className="pitch-card p-4 flex items-center gap-3 hover:bg-secondary/40 transition-colors"
            >
              <Trophy aria-hidden="true" className="h-5 w-5 text-accent" />
              <span className="font-display font-bold tracking-tight">Leaderboard</span>
              <span aria-hidden="true" className="ml-auto text-muted-foreground text-sm">→</span>
            </Link>
          </div>

          {/* Leaderboard preview: top 5 */}
          <section className="mb-8">
            <h2 className="font-display text-xl font-bold tracking-tight mb-3">
                {`Top ${entries.length >10 ? "10": entries.length}`}
            </h2>
            
            <LeaderboardList
              entries={entries.slice(0, 10)}
              groupId={groupId}
            />
            <div className="flex justify-end mt-2">
          
            </div>
          </section>
        </div>
      </main>
    </PitchBg>
  );
}
