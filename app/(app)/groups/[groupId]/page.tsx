import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { InviteBanner } from "@/components/groups/InviteBanner";

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
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to pools
        </Link>

        <p className="micro-label mb-2">{group.competition.name}</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
          {group.name}
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          {group.members.length}{" "}
          {group.members.length === 1 ? "member" : "members"}
        </p>

        <div className="mb-8">
          <InviteBanner inviteCode={group.inviteCode} />
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Link
            href={`/groups/${groupId}/matches`}
            className="paper-card p-6 hover:-translate-y-0.5 transition-transform"
          >
            <p className="micro-label mb-2">Fixtures</p>
            <h2 className="font-display text-2xl font-bold tracking-tight mb-1">
              Matches
            </h2>
            <p className="text-muted-foreground text-sm">
              Today&apos;s games and your predictions.
            </p>
          </Link>

          <Link
            href={`/groups/${groupId}/leaderboard`}
            className="paper-card p-6 hover:-translate-y-0.5 transition-transform"
          >
            <p className="micro-label mb-2">Standings</p>
            <h2 className="font-display text-2xl font-bold tracking-tight mb-1">
              Leaderboard
            </h2>
            <p className="text-muted-foreground text-sm">
              See who&apos;s winning the pool.
            </p>
          </Link>

          <div className="paper-card p-6">
            <p className="micro-label mb-2">Members</p>
            <h2 className="font-display text-2xl font-bold tracking-tight mb-3">
              Roster
            </h2>
            <ul className="space-y-1 text-sm">
              {group.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span>{m.user.emoji}</span>
                  <span>{m.user.nickname}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
