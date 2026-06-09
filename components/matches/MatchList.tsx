"use client";

import { useMemo, useState } from "react";
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
  const grouped = useMemo(
    () => groupByDay(matches, serverNow),
    [matches, serverNow],
  );

  // Default the first 2 day-groups to open, the rest closed. The user
  // can toggle any day header to expand or collapse. The state is
  // local — it does not persist across navigation.
  const [openDays, setOpenDays] = useState<Set<string>>(
    () => new Set(grouped.slice(0, 2).map((g) => g.day)),
  );

  function toggleDay(day: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  if (matches.length === 0) {
    return (
      <div className="pitch-card-hero p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No matches yet for this competition.
        </p>
      </div>
    );
  }

  return (
    <div className="space">
      {grouped.map(({ day, items }) => {
        const isOpen = openDays.has(day);
        return (
          <div key={day}>
            <button
              type="button"
              onClick={() => toggleDay(day)}
              aria-expanded={isOpen}
              className="w-full flex items-center justify-between gap-2 micro-tag sticky top-0 bg-background/80 backdrop-blur-sm py-2 -mx-1 px-1 z-10 text-left"
            >
              <span>
                {day} · {items.length} {items.length === 1 ? "match" : "matches"}
              </span>
              <span
                aria-hidden="true"
                className={`inline-block transition-transform ${
                  isOpen ? "rotate-90" : ""
                }`}
              >
                ▶
              </span>
            </button>
            {isOpen && (
              <div className="space-y-3 mt-3">
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
            )}
          </div>
        );
      })}
    </div>
  );
}

function groupByDay(matches: FeedMatch[], _serverNow: string) {
  // Group by UTC date — display stays consistent across users in any
  // timezone. The serverNow param is unused but kept for forward
  // compatibility (e.g. "today / tomorrow" labels).
  const buckets = new Map<string, FeedMatch[]>();
  for (const m of matches) {
    const date = new Date(m.kickoffTime);
    const day = date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "UTC",
    });
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day)!.push(m);
  }
  return Array.from(buckets.entries()).map(([day, items]) => ({ day, items }));
}
