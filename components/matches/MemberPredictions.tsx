import type { FeedOtherBet } from "@/lib/services/group-feed";

export function MemberPredictions({
  otherBets,
}: {
  otherBets: FeedOtherBet[];
}) {
  if (otherBets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="micro-label">Others:</span>
      {otherBets.map((b) => (
        <span
          key={b.userId}
          className="font-mono bg-background/40 border border-border rounded-full px-2 py-0.5"
        >
          {b.emoji} {b.nickname}:{" "}
          <span className={b.isMasked ? "text-muted-foreground" : ""}>
            {b.predictedValue}
          </span>
        </span>
      ))}
    </div>
  );
}
