"use client";

import { useMemo } from "react";
import type { FeedMatch } from "@/lib/services/group-feed";
import { MatchCard } from "./MatchCard";

export function MatchList({
  matches,
  serverNow,
  lockdownMs,
  groupId,
}: {
  matches: FeedMatch[];
  serverNow: string;
  lockdownMs: number;
  groupId: string;
}) {
  const grouped = useMemo(() => groupByDay(matches, serverNow), [matches, serverNow]);

  if (matches.length === 0) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No matches yet for this competition.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {grouped.map(({ day, items }) => (
        <div key={day}>
          <p className="micro-label mb-3 sticky top-0 bg-background/80 backdrop-blur-sm py-2 -mx-1 px-1 z-10">
            {day}
          </p>
          <div className="space-y-3">
            {items.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                serverNow={serverNow}
                lockdownMs={lockdownMs}
                groupId={groupId}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupByDay(matches: FeedMatch[], serverNow: string) {
  // Use the device locale for display; the date for grouping is in the
  // viewer's local timezone (which is what the user expects).
  const serverStart = new Date(serverNow).getTime();
  const buckets = new Map<string, FeedMatch[]>();
  for (const m of matches) {
    const date = new Date(m.kickoffTime);
    const day = date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day)!.push(m);
    void serverStart;
  }
  return Array.from(buckets.entries()).map(([day, items]) => ({ day, items }));
}
