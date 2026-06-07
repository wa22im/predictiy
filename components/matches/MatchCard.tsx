"use client";

import type { FeedMatch } from "@/lib/services/group-feed";
import { Countdown } from "./Countdown";
import { MemberPredictions } from "./MemberPredictions";
import { PredictionForm } from "./PredictionForm";

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

  return (
    <article className="paper-card p-4 md:p-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg md:text-xl font-bold tracking-tight">
            {teams}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {new Date(match.kickoffTime).toLocaleString(undefined, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            })}
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

      <div className="space-y-4">
        {match.markets.map((mk) => (
          <div key={mk.id} className="space-y-2">
            <p className="text-sm font-medium">{mk.title}</p>
            <PredictionForm
              market={mk}
              groupId={groupId}
              matchLocked={match.isLocked || match.status === "FINISHED"}
            />
            <MemberPredictions otherBets={mk.otherBets} />
          </div>
        ))}
      </div>
    </article>
  );
}
