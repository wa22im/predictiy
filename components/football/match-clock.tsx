"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

type ResolvedVariant = "countdown" | "live" | "ft";

function resolveVariant(
  kickoffMs: number,
  nowMs: number,
): ResolvedVariant {
  if (nowMs < kickoffMs) return "countdown";
  if (nowMs - kickoffMs < TWO_HOURS_MS) return "live";
  return "ft";
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${pad2(hours)} : ${pad2(minutes)} : ${pad2(seconds)}`;
  }
  return `${pad2(minutes)} : ${pad2(seconds)}`;
}

function CountdownDigits({ targetMs, nowMs }: { targetMs: number; nowMs: number }) {
  return (
    <span
      className="font-display font-bold tabular-nums text-foreground"
      data-testid="match-clock-countdown"
    >
      {formatRemaining(Math.max(0, targetMs - nowMs))}
    </span>
  );
}

function LiveBadge() {
  return (
    <span
      className="micro-tag bg-destructive/15 text-destructive border-destructive"
      data-testid="match-clock-live"
    >
      <span
        aria-hidden="true"
        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-destructive"
      />
      LIVE
    </span>
  );
}

function FtBadge() {
  return (
    <span
      className="micro-tag bg-muted text-muted-foreground border-muted-foreground/30"
      data-testid="match-clock-ft"
    >
      FT
    </span>
  );
}

export type MatchClockProps = {
  kickoffAt: string | Date;
  variant?: ResolvedVariant;
  className?: string;
};

export function MatchClock({
  kickoffAt,
  variant,
  className,
}: MatchClockProps) {
  const kickoffMs =
    kickoffAt instanceof Date ? kickoffAt.getTime() : new Date(kickoffAt).getTime();

  // SSR-stable initial value: pretend the wall clock is the kickoff time so
  // the first paint never shows a non-deterministic countdown. The effect
  // below replaces this on mount with the real client clock.
  const [nowMs, setNowMs] = useState<number>(kickoffMs);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resolved: ResolvedVariant = variant ?? resolveVariant(kickoffMs, nowMs);

  return (
    <div
      className={cn("inline-flex items-center", className)}
      data-testid="match-clock"
      data-variant={resolved}
    >
      {resolved === "countdown" ? (
        <CountdownDigits targetMs={kickoffMs} nowMs={nowMs} />
      ) : resolved === "live" ? (
        <LiveBadge />
      ) : (
        <FtBadge />
      )}
    </div>
  );
}
