import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getGroupFeed } from "@/lib/services/group-feed";
import { MatchList } from "@/components/matches/MatchList";

// Force dynamic rendering — the page reads cookies() via Supabase AND
// computes per-request time-dependent state (isLocked, timeUntilLockMs).
// Without this, Next.js can serve a cached version where a match that
// has since entered its 5-min lockdown window still shows as editable.
export const dynamic = "force-dynamic";

type Params = Promise<{ groupId: string }>;

export default async function MatchesPage({ params }: { params: Params }) {
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
      _count: { select: { members: true } },
    },
  });
  if (!group) notFound();

  const isMember = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: user.id, groupId } },
  });
  if (!isMember) redirect("/dashboard");

  const feed = await getGroupFeed(groupId, user.id);

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <a
          href={`/groups/${groupId}`}
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to {group.name}
        </a>

        <p className="micro-label mb-2">{group.competition.name}</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
          Matches
        </h1>
        <p className="text-muted-foreground text-sm leading-6 mb-8">
          {group._count.members}{" "}
          {group._count.members === 1 ? "member" : "members"} · predictions lock
          5 minutes before kickoff.
        </p>

        <MatchList
          matches={feed.matches}
          serverNow={feed.serverNow}
          lockdownMs={feed.lockdownMs}
          groupId={groupId}
        />
      </div>
    </main>
  );
}
