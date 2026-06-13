"use client";

import type { FeedMatch } from "@/lib/services/group-feed";
import { formatUtc } from "@/lib/time";
import { Countdown } from "./Countdown";
import { MemberPredictions } from "./MemberPredictions";
import { MatchBettingForm } from "./MatchBettingForm";
import { CrestSlot, MatchClock, ScoreBug } from "@/components/football";
import { CheckCircle2 } from "lucide-react";

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

  const hasAnyBet = match.markets.some((m) => m.viewerBet !== null);
  const matchState: "has-bet" | "not-yet" | "locked" = match.isLocked
    ? "locked"
    : hasAnyBet
    ? "has-bet"
    : "not-yet";

  const allOtherBets = match.markets.flatMap((m) => m.otherBets);
  const deduped = dedupeByUser(allOtherBets);

  const scoreBugStatus =
    match.status === "FINISHED"
      ? "ft"
      : match.isLocked
      ? "live"
      : "scheduled";

  // Determine if the viewer has a successful prediction (visual feedback)
  // This is a simplified logic for the demo; in production it should be part of the backend response.
  const hasCorrectPrediction = match.status === "FINISHED" && match.markets.some(m => {
    const viewerBet = m.viewerBet;
    if (!viewerBet) return false;
    return m.correctAnswer === viewerBet.predictedValue;
  });

  // Top-border color encodes the match status at a glance:
  //   - FINISHED: blue-500 (settled, no further action)
  //   - GOING: success green (live)
  //   - SCHEDULED + locked: emerald-400 (in the 5-min lockdown, soon)
  //   - SCHEDULED + not locked: muted gray (still editable, no rush)
  const statusBorderClass = (() => {
    if (match.status === "FINISHED") return "border-t-blue-500";
    if (match.status === "GOING") return "border-t-success";
    if (match.isLocked) return "border-t-emerald-400";
    return "border-t-muted";
  })();

  const stateClass =
    matchState === "has-bet"
      ? `pitch-card p-3 md:p-4 space-y-4 border-t-4 ${statusBorderClass} shadow-[0_0_18px_-2px_var(--primary)]`
      : matchState === "locked"
      ? `pitch-card p-3 md:p-4 space-y-4 border-t-4 ${statusBorderClass} shadow-[0_0_12px_-4px_var(--locked)]`
      : `pitch-card p-3 md:p-4 space-y-4 border-t-4 ${statusBorderClass}`;

  return (
    <article className={`${stateClass} ${hasCorrectPrediction ? "ring-2 ring-success ring-offset-2 ring-offset-background" : ""}`}>
      {hasCorrectPrediction && (
        <div
          aria-label="Correct prediction"
          role="img"
          className="absolute top-2 right-2 z-10 bg-success text-white rounded-full p-1 shadow-lg"
        >
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
        </div>
      )}

      {!hasOutright ? (
        <ScoreBug
          home={match.homeTeam}
          away={match.awayTeam}
          homeScore={match.homeScore}
          awayScore={match.awayScore}
          status={scoreBugStatus}
          kickoffAt={match.kickoffTime}
          homeCrest={match.homeCrest}
          awayCrest={match.awayCrest}
        />
      ) : (
        <header className="flex items-center gap-2">
          <CrestSlot src={match.homeCrest} name={match.homeTeam} size="sm" />
          <p className="font-display text-lg md:text-xl font-bold tracking-tight">
            {teams}
          </p>
        </header>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground font-mono">
          <span className="mr-2">
            <ResultLine match={match} />
          </span>
          {formatUtc(match.kickoffTime)}
        </p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="text-right">
            {match.status === "FINISHED" ? (
              <span className="micro-tag text-muted-foreground">Settled</span>
            ) : match.isLocked ? (
              <span className="micro-tag text-destructive">Locked</span>
            ) : (
              <Countdown
                kickoffTime={match.kickoffTime}
                lockdownMs={lockdownMs}
                serverNow={serverNow}
              />
            )}
          </div>
        </div>
      </div>

      <MatchBettingForm match={match} groupId={groupId} />

      <MemberPredictions otherBets={deduped} />
    </article>
  );
}

function ResultLine({ match }: { match: FeedMatch }) {
  if (match.status !== "FINISHED") return null;
  if (match.homeScore === null || match.awayScore === null) return null;
  const extras: string[] = [];
  if (match.homeHtGoals !== null && match.awayHtGoals !== null) {
    extras.push(`HT ${match.homeHtGoals}-${match.awayHtGoals}`);
  }
  if (match.homePenalties !== null && match.awayPenalties !== null) {
    extras.push(`${match.homePenalties}-${match.awayPenalties} pens`);
  }
  return (
    <span className="text-sm font-mono">
      <span className="micro-tag mr-2">Final</span>
      <span className="font-bold text-foreground">
        {match.homeScore}-{match.awayScore}
      </span>
      {extras.length > 0 && (
        <span className="text-muted-foreground ml-2 text-xs">
          ({extras.join(", ")})
        </span>
      )}
    </span>
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
