"use client";

import { useMemo, useState } from "react";
import {
  SettlementMatchForm,
  type SettlementMatchFormInitial,
} from "./SettlementMatchForm";

type Day = { day: string; items: SettlementMatchFormInitial[] };

/**
 * Day accordion for the Settlement Hub. Mirrors the pattern in
 * `components/matches/MatchList.tsx`:
 *   - first 2 day-groups open by default, the rest closed
 *   - clicking the day header toggles open/closed
 *   - chevron rotates 90° when open
 *   - state is local to this component (per-tournament, since the
 *     accordion is rendered inside the per-tournament section)
 */
export function SettlementDayAccordion({
  matches,
}: {
  matches: SettlementMatchFormInitial[];
}) {
  const grouped = useMemo(() => groupByDay(matches), [matches]);

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

  return (
    <div className="space-y-3">
      {grouped.map(({ day, items }) => {
        const isOpen = openDays.has(day);
        return (
          <div key={day}>
            <button
              type="button"
              onClick={() => toggleDay(day)}
              aria-expanded={isOpen}
              className="w-full flex items-center justify-between gap-2 micro-label sticky top-0 bg-background/80 backdrop-blur-sm py-2 -mx-1 px-1 z-10 text-left"
            >
              <span>
                {day} · {items.length}{" "}
                {items.length === 1 ? "match" : "matches"}
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
                  <SettlementMatchForm key={m.id} match={m} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function groupByDay(matches: SettlementMatchFormInitial[]): Day[] {
  // Group by UTC date — same pattern as MatchList. Stable across
  // user timezones.
  const buckets = new Map<string, SettlementMatchFormInitial[]>();
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
