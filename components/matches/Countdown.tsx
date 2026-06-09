"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/time";

/**
 * Server-time-anchored countdown. Initial time is computed from
 * `serverNow + (now - pageLoad)` so the device clock cannot be used
 * to manipulate the displayed value.
 */
export function Countdown({
  kickoffTime,
  lockdownMs,
  serverNow,
}: {
  kickoffTime: string;
  lockdownMs: number;
  serverNow: string;
}) {
  const [ms, setMs] = useState(() => compute(kickoffTime, lockdownMs, serverNow));

  useEffect(() => {
    const id = setInterval(() => {
      setMs(compute(kickoffTime, lockdownMs, serverNow));
    }, 1000);
    return () => clearInterval(id);
  }, [kickoffTime, lockdownMs, serverNow]);

  if (ms <= 0) {
    return <span className="micro-tag text-destructive">Locked</span>;
  }

  return (
    <div className="text-right">
      <p className="micro-tag">Locks in</p>
      <p className="font-mono text-sm">{formatCountdown(ms)}</p>
    </div>
  );
}

function compute(kickoffTime: string, lockdownMs: number, serverNow: string) {
  const lockAt = new Date(kickoffTime).getTime() - lockdownMs;
  const elapsed = Date.now() - new Date(serverNow).getTime();
  return Math.max(0, lockAt - (new Date(serverNow).getTime() + elapsed));
}
