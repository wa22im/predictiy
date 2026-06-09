"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/time";
import { MatchClock } from "@/components/football";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export function Countdown({
  kickoffTime,
  lockdownMs,
  serverNow,
}: {
  kickoffTime: string;
  lockdownMs: number;
  serverNow: string;
}) {
  const [ms, setMs] = useState(() =>
    compute(kickoffTime, lockdownMs, serverNow)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setMs(compute(kickoffTime, lockdownMs, serverNow));
    }, 1000);

    return () => clearInterval(id);
  }, [kickoffTime, lockdownMs, serverNow]);

  if (ms <= 0) {
    return <span className="micro-tag text-destructive">Locked</span>;
  }

  const kickoffMs = new Date(kickoffTime).getTime();
  const nowMs =
    new Date(serverNow).getTime() +
    (Date.now() - new Date(serverNow).getTime());

  const timeUntilKickoff = kickoffMs - nowMs;

  // More than 2 days away → show only MatchClock
  if (timeUntilKickoff < TWO_DAYS_MS) {
    return <MatchClock kickoffAt={kickoffTime} />;
  }

  // Within 2 days → show countdown
  return (
    <div className="text-right">
      <p className="micro-tag">Locks in</p>
      <p className="font-mono text-sm">{formatCountdown(ms)}</p>
    </div>
  );
}

function compute(
  kickoffTime: string,
  lockdownMs: number,
  serverNow: string
) {
  const lockAt = new Date(kickoffTime).getTime() - lockdownMs;
  const elapsed = Date.now() - new Date(serverNow).getTime();

  return Math.max(
    0,
    lockAt - (new Date(serverNow).getTime() + elapsed)
  );
}