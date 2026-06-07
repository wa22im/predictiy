import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getMemberHistory } from "@/lib/services/member-history";
import { cn } from "@/lib/utils";

type Params = Promise<{ groupId: string; userId: string }>;

export default async function MemberHistoryPage({ params }: { params: Params }) {
  const { groupId, userId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isMember = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: user.id, groupId } },
  });
  if (!isMember) redirect("/dashboard");

  let history;
  try {
    history = await getMemberHistory(groupId, userId);
  } catch {
    notFound();
  }

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Link
          href={`/groups/${groupId}/leaderboard`}
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to leaderboard
        </Link>
        <p className="micro-label mb-2">History</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-1">
          {history.member.emoji} {history.member.nickname}
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          {history.member.totalPoints} points · {history.items.length}{" "}
          bet{history.items.length === 1 ? "" : "s"} placed
        </p>

        {history.items.length === 0 ? (
          <div className="glass-panel p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No bets placed yet.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {history.items.map((it) => (
              <li
                key={it.marketId}
                className="paper-card p-4 space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {it.matchLabel ?? it.marketTitle}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {it.marketTitle}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "font-display text-xl font-bold tabular-nums shrink-0",
                      it.points > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {it.points > 0 ? `+${it.points}` : it.points}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  Pick: {it.predictedValue}
                  {it.correctAnswer && (
                    <>
                      {" · "}Answer:{" "}
                      <span className="text-foreground">{it.correctAnswer}</span>
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{it.breakdown}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
