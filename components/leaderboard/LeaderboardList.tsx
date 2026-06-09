import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/services/leaderboard";
import { cn } from "@/lib/utils";
import { CrestSlot } from "@/components/football";
import type { RatingTier } from "@/components/football";

function rankToTier(rank: number): RatingTier | null {
  if (rank === 1) return "totw";
  if (rank === 2) return "if";
  if (rank === 3) return "gold";
  return null;
}

export function LeaderboardList({
  entries,
  groupId,
}: {
  entries: LeaderboardEntry[];
  groupId: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="pitch-card-hero p-8 text-center">
        <p className="text-muted-foreground text-sm">No members yet.</p>
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {entries.map((e, index) => {
        const tier = rankToTier(e.rank);
        const isFirst = index === 0;
        // Rank 1 gets a crown; last rank gets a clown. Crown takes priority
        // if the pool has 1 member.
        const isLast = !isFirst && index === entries.length - 1;
        return (
          <li
            key={e.userId}
            className={cn(
              e.rank <= 3
                ? "pitch-card-fut p-4 flex items-center gap-4"
                : "pitch-card p-4 flex items-center gap-4",
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
            {isFirst && (
              <span
                className="text-base shrink-0"
                aria-label="First place"
              >
                👑
              </span>
            )}
            {isLast && (
              <span
                className="text-base shrink-0"
                aria-label="Last place"
              >
                🤡
              </span>
            )}
            <CrestSlot name={e.nickname} size="sm" tint={tier} />
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 min-w-0">
                {e.emoji ? (
                  <span
                    className="text-lg shrink-0 leading-none"
                    aria-hidden="true"
                  >
                    {e.emoji}
                  </span>
                ) : null}
                <p className="font-display text-lg font-bold tracking-tight truncate">
                  {e.nickname}
                </p>
              </div>
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
        );
      })}
    </ol>
  );
}
