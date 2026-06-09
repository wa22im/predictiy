"use client";

import type { FeedMatch } from "@/lib/services/group-feed";
import { formatUtc } from "@/lib/time";
import { Countdown } from "./Countdown";
import { MemberPredictions } from "./MemberPredictions";
import { MatchBettingForm } from "./MatchBettingForm";
import { CrestSlot, MatchClock, ScoreBug } from "@/components/football";

// Decision: CrestOrFallback was a hand-rolled 28px local helper;
// it is replaced entirely by the CrestSlot primitive so the size,
// initials fallback, and (where applicable) rating ring stay in one
// place. The previous 28px round size collapses to the primitive's
// 24px "sm" to align with the rest of the system.
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

  // Other members' predictions (aggregated across all markets) — show
  // once per match rather than per market. The feed still exposes
  // per-market otherBets; we pull all of them and dedupe by user.
  const allOtherBets = match.markets.flatMap((m) => m.otherBets);
  const deduped = dedupeByUser(allOtherBets);

  // Map the feed's free-form status string onto the ScoreBug's
  // scheduled/live/ft enum. Anything unknown falls back to "scheduled".
  const scoreBugStatus =
    match.status === "FINISHED"
      ? "ft"
      : match.isLocked
      ? "live"
      : "scheduled";

  return (
    <article className="pitch-card p-3 md:p-4 space-y-4">
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
          <MatchClock kickoffAt={match.kickoffTime} />
        </div>
      </div>

      <MatchBettingForm match={match} groupId={groupId} />

      <MemberPredictions otherBets={deduped} />
    </article>
  );
}

/**
 * Final-score line rendered when a match is FINISHED. Returns null for
 * in-progress / scheduled matches, and defensively null when scores are
 * missing. HT and penalties are appended as comma-separated extras in
 * parentheses.
 */
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
