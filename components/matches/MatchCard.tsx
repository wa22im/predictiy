"use client";

import type { FeedMatch } from "@/lib/services/group-feed";
import { formatUtc, formatCountdown } from "@/lib/time";
import { Countdown } from "./Countdown";
import { MemberPredictions } from "./MemberPredictions";
import { MatchBettingForm } from "./MatchBettingForm";

export function MatchCard({
  match,
  serverNow,
  lockdownMs,
  groupId,
}: {
  match: FeedMatch;
  serverNow: string;
  lockdownMs: number;
  groupId: string;
}) {
  const hasOutright = match.markets.some((mk) => !match.homeTeam || !match.awayTeam);
  const teams = hasOutright
    ? match.homeTeam
    : `${match.homeTeam} vs ${match.awayTeam}`;

  // Display the time-from-now relative to the server clock so the user
  // can sanity-check the absolute timestamp. Always positive; locked
  // matches show "Started".
  const msToKickoff = new Date(match.kickoffTime).getTime() - new Date(serverNow).getTime();
  const relative = msToKickoff > 0 ? `in ${formatCountdown(msToKickoff)}` : "Started";

  // Other members' predictions (aggregated across all markets) — show
  // once per match rather than per market. The feed still exposes
  // per-market otherBets; we pull all of them and dedupe by user.
  const allOtherBets = match.markets.flatMap((m) => m.otherBets);
  const deduped = dedupeByUser(allOtherBets);

  return (
    <article className="paper-card p-3 md:p-4 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg md:text-xl font-bold tracking-tight">
            {teams}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {formatUtc(match.kickoffTime)} · {relative}
          </p>
        </div>
        <div className="text-right shrink-0">
          {match.status === "FINISHED" ? (
            <span className="micro-label text-muted-foreground">Settled</span>
          ) : match.isLocked ? (
            <span className="micro-label text-destructive">Locked</span>
          ) : (
            <Countdown
              kickoffTime={match.kickoffTime}
              lockdownMs={lockdownMs}
              serverNow={serverNow}
            />
          )}
        </div>
      </header>

      <MatchBettingForm match={match} groupId={groupId} />

      <MemberPredictions otherBets={deduped} />
    </article>
  );
}

function dedupeByUser<T extends { userId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    out.push(r);
  }
  return out;
}
