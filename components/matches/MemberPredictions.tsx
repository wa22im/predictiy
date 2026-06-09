import type { FeedOtherBet } from "@/lib/services/group-feed";
import { CrestSlot } from "@/components/football";

export function MemberPredictions({
  otherBets,
}: {
  otherBets: FeedOtherBet[];
}) {
  if (otherBets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="micro-tag">Others:</span>
      {otherBets.map((b) => (
        <span
          key={b.userId}
          className="inline-flex items-center gap-1.5 font-mono bg-background/40 border border-border rounded-full pl-1 pr-2 py-0.5"
        >
          <CrestSlot name={b.nickname} size="sm" />
          <span>
            {b.emoji} {b.nickname}:{" "}
            <span className={b.isMasked ? "text-muted-foreground" : ""}>
              {b.predictedValue}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
