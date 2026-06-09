import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { ShareInvite } from "@/components/groups/ShareInvite";
import { PitchBg, CrestSlot } from "@/components/football";

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

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
            <div className="inline-flex items-center gap-2 text-sm">
              <Link
                href="/dashboard"
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                Back 
              </Link>
              <span aria-hidden="true" className="text-border">/</span>
           
            </div>
          </div>
          </div>
          <div className=" mb-8">           
             <h1 className="font-display  sm:text-4xl font-bold tracking-tight ">
              {group.name}
            </h1>
               <span className="text-foreground font-display tracking-tight">
                {group.competition.name}
              </span>
                <p className="text-muted-foreground text-sm mb-8">
            {group.members.length}{" "}
            {group.members.length === 1 ? "member" : "members"}
          </p>
            <div/>
      

          <div className="mb-8">
            <ShareInvite inviteCode={group.inviteCode} />
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <Link
              href={`/groups/${groupId}/matches`}
              className="pitch-card p-6 hover:-translate-y-0.5 transition-transform"
            >
              <p className="micro-tag mb-2">Fixtures</p>
              <h2 className="font-display text-2xl font-bold tracking-tight mb-1">
                Matches
              </h2>
              <p className="text-muted-foreground text-sm">
                Today&apos;s games and your predictions.
              </p>
            </Link>

            <Link
              href={`/groups/${groupId}/leaderboard`}
              className="pitch-card p-6 hover:-translate-y-0.5 transition-transform"
            >
              <p className="micro-tag mb-2">Standings</p>
              <h2 className="font-display text-2xl font-bold tracking-tight mb-1">
                Leaderboard
              </h2>
              <p className="text-muted-foreground text-sm">
                See who&apos;s winning the pool.
              </p>
            </Link>

            <div className="pitch-card p-6">
              <p className="micro-tag mb-2">Members</p>
              <ul className="space-y-1 text-sm">
                {group.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <CrestSlot name={m.user.nickname} size="sm" />
                    <span>{m.user.nickname}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </main>
    </PitchBg>
  );
}
