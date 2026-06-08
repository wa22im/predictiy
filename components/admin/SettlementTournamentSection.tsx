"use client";

import { useMemo } from "react";
import { SettlementDayAccordion } from "./SettlementDayAccordion";
import type { SettlementMatchFormInitial } from "./SettlementMatchForm";

export type SettlementTournamentSectionProps = {
  competitionId: string;
  competitionName: string;
  matches: SettlementMatchFormInitial[];
};

export function SettlementTournamentSection({
  competitionName,
  matches,
}: SettlementTournamentSectionProps) {
  // Sort once at this layer: ascending by kickoffTime so day groups
  // appear in chronological order. The day-accordion then groups
  // them by UTC date internally.
  const sorted = useMemo(
    () =>
      [...matches].sort(
        (a, b) =>
          new Date(a.kickoffTime).getTime() -
          new Date(b.kickoffTime).getTime(),
      ),
    [matches],
  );

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl md:text-3xl tracking-tight">
          {competitionName}
        </h2>
        <span className="micro-label">
          {matches.length} {matches.length === 1 ? "match" : "matches"}
        </span>
      </header>
      <SettlementDayAccordion matches={sorted} />
    </section>
  );
}
