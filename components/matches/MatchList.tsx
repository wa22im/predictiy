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

  // Default-open: 3 OLDEST day-groups that contain at least one
  // unsettled match. The day-groups are sorted chronologically
  // (oldest first) by groupByDay, so the first 3 entries of the
  // filtered (unsettled) array are the 3 oldest unsettled days.
  // The user can toggle any day header to expand or collapse. The
  // state is local — it does not persist across navigation. Days
  // with all-FINISHED match lists stay closed, as do day-groups
  // beyond the top 3 even if they have unsettled matches.
  const [openDays, setOpenDays] = useState<Set<string>>(
    () =>
      new Set(
        grouped
          .filter((g) => g.items.some((m) => m.status !== "FINISHED"))
          .slice(0, 3)
          .map((g) => g.day),
      ),
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
  className="w-[calc(100%+2rem)] -mx-4 my-2 flex items-center justify-between gap-2 micro-tag sticky top-0 bg-background/80 backdrop-blur-sm py-2 px-4 z-10 text-left"
            >
              <span>
                {day} · {items.length} {items.length === 1 ? "match" : "matches"}
              </span>
              <span
              
                aria-hidden="true"
                className={`inline-block transition-transform ${
                  isOpen ? "rotate-90" : ""
                }` }
              >
                ▶
              </span>
            </button>
            {isOpen && (
              <div className="space-y-3 mt-3">
                {items.map((m) => (
                  <MatchCard
                    key={`${groupId}-${m.id}`}
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
  // Simple: sort matches first, then group while maintaining order
  const sortedMatches = [...matches].sort((a, b) => 
    new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime()
  );
  
  const result: { day: string; items: FeedMatch[] }[] = [];
  
  for (const match of sortedMatches) {
    const date = new Date(match.kickoffTime);
    const day = date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "UTC",
    });
    
    const lastGroup = result[result.length - 1];
    if (lastGroup && lastGroup.day === day) {
      lastGroup.items.push(match);
    } else {
      result.push({ day, items: [match] });
    }
  }
  
  return result;
}
