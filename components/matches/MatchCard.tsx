"use client";

import { useState } from "react";
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

  // For outright markets there's no "away team" — only render the away
  // crest slot when we actually have an away team to label.
  const showAwayCrest = !hasOutright && Boolean(match.awayTeam);

  return (
    <article className="paper-card p-3 md:p-4 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CrestOrFallback url={match.homeCrest} name={match.homeTeam} />
            <p className="font-display text-lg md:text-xl font-bold tracking-tight">
              {teams}
            </p>
            {showAwayCrest && (
              <CrestOrFallback url={match.awayCrest} name={match.awayTeam} />
            )}
          </div>
          <ResultLine match={match} />
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

/**
 * Final-score line rendered between the team names and the kickoff time
 * when a match is FINISHED. Returns null for in-progress / scheduled
 * matches, and defensively null when scores are missing. HT and
 * penalties are appended as comma-separated extras in parentheses.
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
    <p className="text-sm font-mono mb-1">
      <span className="micro-label mr-2">Final</span>
      <span className="font-bold text-foreground">
        {match.homeScore}-{match.awayScore}
      </span>
      {extras.length > 0 && (
        <span className="text-muted-foreground ml-2 text-xs">
          ({extras.join(", ")})
        </span>
      )}
    </p>
  );
}

/**
 * 28px circular crest with a team-initial fallback. Used twice in the
 * header (home + away). Falls back to initials when:
 *   - the URL is null (no crest provided by the source), or
 *   - the image fails to load (broken URL, CORS, network, etc.).
 *
 * We use a plain <img> rather than next/image: crests come from
 * third-party CDNs (football-data.org / flagcdn), and the optimization
 * benefit is negligible for a 28×28 badge.
 */
function CrestOrFallback({
  url,
  name,
}: {
  url: string | null;
  name: string;
}) {
  const [errored, setErrored] = useState(false);
  const showImage = url && !errored;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/40 border border-border text-[10px] font-bold text-muted-foreground overflow-hidden shrink-0"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`${name} crest`}
          loading="lazy"
          onError={() => setErrored(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <span>{name.slice(0, 1).toUpperCase()}</span>
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
