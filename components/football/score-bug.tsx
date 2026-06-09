"use client";

import { cn } from "@/lib/utils";
import { CrestSlot } from "./crest-slot";
import type { MatchStatus } from "./types";

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function formatKickoffUtc(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return TIME_FMT.format(d);
}

function StatusBadge({
  status,
  kickoffAt,
}: {
  status: MatchStatus;
  kickoffAt?: string | Date;
}) {
  if (status === "live") {
    return (
      <span className="micro-tag bg-destructive/15 text-destructive border-destructive">
        <span
          aria-hidden="true"
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-destructive"
        />
        LIVE
      </span>
    );
  }
  if (status === "ft") {
    return (
      <span className="micro-tag bg-muted text-muted-foreground border-muted-foreground/30">
        FT
      </span>
    );
  }
  const label = kickoffAt ? `KO ${formatKickoffUtc(kickoffAt)}` : "SCHEDULED";
  return (
    <span className="micro-tag border-border text-muted-foreground">{label}</span>
  );
}

function ScoreOrDash({ value }: { value: number | null }) {
  return (
    <span className="font-display font-extrabold text-3xl tracking-tight tabular-nums text-foreground">
      {value === null || value === undefined ? "\u2013" : value}
    </span>
  );
}

export type ScoreBugProps = {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  kickoffAt?: string | Date;
  homeCrest?: string | null;
  awayCrest?: string | null;
  className?: string;
};

export function ScoreBug({
  home,
  away,
  homeScore,
  awayScore,
  status,
  kickoffAt,
  homeCrest,
  awayCrest,
  className,
}: ScoreBugProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {homeCrest ? <CrestSlot src={homeCrest} name={home} size="sm" /> : null}
        <span className="truncate font-display font-bold uppercase tracking-tight text-foreground">
          {home}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ScoreOrDash value={homeScore} />
        <span className="font-display text-3xl text-muted-foreground">&ndash;</span>
        <ScoreOrDash value={awayScore} />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span className="truncate text-right font-display font-bold uppercase tracking-tight text-foreground">
          {away}
        </span>
        {awayCrest ? <CrestSlot src={awayCrest} name={away} size="sm" /> : null}
      </div>
    </div>
  );
}
