import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getMemberHistory } from "@/lib/services/member-history";
import { cn } from "@/lib/utils";
import { PitchBg, CrestSlot } from "@/components/football";

export const dynamic = "force-dynamic";

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
    history = await getMemberHistory(groupId, userId, user.id);
  } catch {
    notFound();
  }

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <Link
            href={`/groups/${groupId}/leaderboard`}
            className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
          >
            ← Back to leaderboard
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <CrestSlot name={history.member.nickname} size="md" />
            <p className="micro-tag">History</p>
          </div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-1">
            {history.member.nickname}
          </h1>
          <p className="text-muted-foreground text-sm mb-8">
            {history.member.totalPoints} points · {history.items.length}{" "}
            bet{history.items.length === 1 ? "" : "s"} placed
          </p>

          {history.items.length === 0 ? (
            <div className="pitch-card-hero p-8 text-center">
              <p className="text-muted-foreground text-sm">
                No bets placed yet.
              </p>
            </div>
          ) : (
            <ol className="space-y-2">
              {history.items.map((it) => (
                <li
                  key={it.marketId}
                  className={cn(
                    "pitch-card p-4 space-y-1",
                    it.isMasked && "opacity-70",
                  )}
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
                        it.points > 0
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {it.points > 0 ? `+${it.points}` : it.points}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    Pick:{" "}
                    <span className={cn(it.isMasked && "tracking-widest")}>
                      {it.predictedValue}
                    </span>
                    {it.correctAnswer && (
                      <>
                        {" · "}Answer:{" "}
                        <span className="text-foreground">
                          {it.correctAnswer}
                        </span>
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
    </PitchBg>
  );
}
