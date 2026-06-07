import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/services/leaderboard";
import { cn } from "@/lib/utils";

export function LeaderboardList({
  entries,
  groupId,
}: {
  entries: LeaderboardEntry[];
  groupId: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-muted-foreground text-sm">No members yet.</p>
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {entries.map((e) => (
        <li
          key={e.userId}
          className={cn(
            "paper-card p-4 flex items-center gap-4",
            e.rank === 1 && "border-primary/60",
          )}
        >
          <span
            className={cn(
              "font-display text-2xl font-bold w-10 text-center shrink-0",
              e.rank === 1 && "text-primary",
            )}
          >
            #{e.rank}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display text-lg font-bold tracking-tight truncate">
              {e.emoji} {e.nickname}
            </p>
            <p className="text-xs text-muted-foreground">
              {e.settledBets} settled bet{e.settledBets === 1 ? "" : "s"}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-display text-2xl font-bold tabular-nums">
              {e.totalPoints}
            </p>
            <p className="text-xs text-muted-foreground">points</p>
          </div>
          <Link
            href={`/groups/${groupId}/members/${e.userId}`}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            History →
          </Link>
        </li>
      ))}
    </ol>
  );
}
