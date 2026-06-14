"use client";

import { useEffect, useState } from "react";
import type { FeedMatch } from "@/lib/services/group-feed";
import { formatUtc } from "@/lib/time";
import { Countdown } from "./Countdown";
import { MemberPredictions } from "./MemberPredictions";
import { MatchBettingForm } from "./MatchBettingForm";
import { CrestSlot } from "@/components/football";
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
      ? `pitch-card p-4 md:p-5 border-t-4 ${statusBorderClass} shadow-[0_0_18px_-2px_var(--primary)]`
      : matchState === "locked"
      ? `pitch-card p-4 md:p-5 border-t-4 ${statusBorderClass} shadow-[0_0_12px_-4px_var(--locked)]`
      : `pitch-card p-4 md:p-5 border-t-4 ${statusBorderClass}`;

  // Live-polling state. The match's score row is updated as the
  // polling effect returns new values. The viewer's betting form
  // uses `liveScores` to show a "live: +N" preview badge next to the
  // viewer's locked bet — see the `livePreview` prop on
  // MatchBettingForm. We initialise from the server-rendered scores
  // so the first paint is correct.
  const [liveScores, setLiveScores] = useState<{
    home: number | null;
    away: number | null;
  } | null>(
    match.status === "GOING"
      ? { home: match.homeScore, away: match.awayScore }
      : null,
  );

  // Polling effect. The endpoint is rate-limited to 5 min per match
  // server-side; on the client we follow the server's `nextRefreshMs`
  // hint so we don't ask for data we won't get. The effect is a no-op
  // for pre-kickoff and FINISHED matches (the server returns
  // `nextRefreshMs: null` and we stop scheduling).
  useEffect(() => {
    if (match.status !== "GOING") return;
    const kickoffMs = new Date(match.kickoffTime).getTime();
    if (kickoffMs > Date.now()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/v1/matches/${match.id}/refresh`, {
          method: "POST",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          homeScore: number | null;
          awayScore: number | null;
          status?: string;
          nextRefreshMs: number | null;
        };
        if (cancelled) return;
        setLiveScores({ home: data.homeScore, away: data.awayScore });
        if (data.nextRefreshMs) {
          timer = setTimeout(poll, data.nextRefreshMs);
        }
      } catch {
        // Network error — back off and retry in 60s.
        if (cancelled) return;
        timer = setTimeout(poll, 60_000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [match.id, match.status, match.kickoffTime]);

  // Effective scores (live > server) for the bottom score row.
  const homeScore = liveScores?.home ?? match.homeScore;
  const awayScore = liveScores?.away ?? match.awayScore;

  return (
    <article className={`${stateClass} relative ${hasCorrectPrediction ? "ring-2 ring-success ring-offset-2 ring-offset-background" : ""}`}>
      {hasCorrectPrediction && (
        <div
          aria-label="Correct prediction"
          role="img"
          className="absolute top-2 right-2 z-10 bg-success text-white rounded-full p-1 shadow-lg"
        >
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
        </div>
      )}

      {/* ROW 1 — teams + crests (large, prominent) */}
      <header className="flex items-center justify-between gap-3">
        {!hasOutright ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <CrestSlot
                src={match.homeCrest}
                name={match.homeTeam}
                size="md"
              />
              <span className="truncate font-display text-xl md:text-2xl font-bold uppercase tracking-tight text-foreground">
                {match.homeTeam}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <span className="truncate text-right font-display text-xl md:text-2xl font-bold uppercase tracking-tight text-foreground">
                {match.awayTeam}
              </span>
              <CrestSlot
                src={match.awayCrest}
                name={match.awayTeam}
                size="md"
              />
            </div>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <CrestSlot
              src={match.homeCrest}
              name={match.homeTeam}
              size="md"
            />
            <span className="truncate font-display text-xl md:text-2xl font-bold uppercase tracking-tight text-foreground">
              {teams}
            </span>
          </div>
        )}
      </header>

      {/* VISUAL SEPARATOR */}
      <div className="my-3 h-px w-full bg-border" aria-hidden="true" />

      {/* ROW 2 — score (left) + game status (right, prominent).
          The game status gets the same visual weight as the score
          (font-display, large, bold) per the ISC. The status is the
          provider's externalStatus verbatim ("HT", "2H 78'", "FT",
          etc.) when present, else a derived label from the typed
          `status` field — see GameStatusBadge below. */}
      <ScoreStatusRow
        match={match}
        homeScore={homeScore}
        awayScore={awayScore}
        hasOutright={hasOutright}
      />

      {/* ROW 3 — bet indicators. Small, dim, secondary. Used to
          be a micro-tag on the score row; now lives in its own
          row so it doesn't compete with the score+status for
          visual weight. Indicators shown:
            - "Locked" — the 5-min save lockdown is in effect
              (the viewer can no longer save/edit bets)
            - "Settled" — the match is FINISHED
            - For SCHEDULED + not locked: a countdown timer
              ("3h 15m" / "12m 30s" / "5s") — the principal
              wants the time-until-kickoff visible too.
          We keep the countdown in this row rather than the score
          row so the score row stays "the final shape of the
          game", and the bet row stays "what can I still do?". */}
      <BetIndicatorsRow match={match} lockdownMs={lockdownMs} serverNow={serverNow} />

      <MatchBettingForm
        match={match}
        groupId={groupId}
        liveScores={liveScores}
      />

      <MemberPredictions otherBets={deduped} />
    </article>
  );
}

function ScoreStatusRow({
  match,
  homeScore,
  awayScore,
  hasOutright,
}: {
  match: FeedMatch;
  homeScore: number | null;
  awayScore: number | null;
  hasOutright: boolean;
}) {
  const showNumericScore =
    !hasOutright && (match.status === "FINISHED" || match.status === "GOING");
  const showDashes = !hasOutright && match.status === "SCHEDULED";

  return (
    <div
      data-testid="score-status-row"
      className="rounded-xl bg-secondary/40 border border-border/60 px-3 py-3 md:px-4 md:py-3 flex items-center justify-between gap-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {hasOutright ? (
          <span className="font-mono text-sm text-foreground truncate">
            {match.status === "FINISHED" && homeScore !== null && awayScore !== null
              ? `Result ${homeScore}-${awayScore}`
              : match.status === "FINISHED"
              ? "Result —"
              : "Awaiting result"}
          </span>
        ) : showNumericScore ? (
          <span className="flex items-center gap-2">
            <span className="font-display font-extrabold text-2xl md:text-3xl tabular-nums text-foreground">
              {homeScore ?? "–"}
            </span>
            <span className="font-display text-2xl md:text-3xl text-muted-foreground">
              –
            </span>
            <span className="font-display font-extrabold text-2xl md:text-3xl tabular-nums text-foreground">
              {awayScore ?? "–"}
            </span>
          </span>
        ) : showDashes ? (
          <span className="flex items-center gap-2">
            <span className="font-display font-extrabold text-2xl md:text-3xl tabular-nums text-muted-foreground">
              –
            </span>
            <span className="font-display text-2xl md:text-3xl text-muted-foreground/50">
              –
            </span>
            <span className="font-display font-extrabold text-2xl md:text-3xl tabular-nums text-muted-foreground">
              –
            </span>
          </span>
        ) : null}
        <ResultExtras match={match} homeScore={homeScore} awayScore={awayScore} />
      </div>

      {/* Game status — same visual weight as the score (font-display
          + large + bold). The badge reads
          `match.externalStatus` verbatim when the provider supplied
          one, and falls back to a derived label otherwise. */}
      <GameStatusBadge match={match} />
    </div>
  );
}

/**
 * Bet indicators row. The status micro-tag (Locked, Settled,
 * Countdown) used to live next to the score; the ISC asks for
 * it to be moved to a separate, smaller, dimmer row so it
 * doesn't compete with the score+status for visual weight.
 *
 * The row is hidden entirely when there's nothing to show
 * (e.g. a SCHEDULED + not-locked + no-bet match — the
 * Countdown component is the indicator, and we'd rather show
 * nothing than a 0-height row that pushes the form down).
 */
function BetIndicatorsRow({
  match,
  lockdownMs,
  serverNow,
}: {
  match: FeedMatch;
  lockdownMs: number;
  serverNow: string;
}) {
  let node: React.ReactNode = null;
  if (match.status === "FINISHED") {
    node = (
      <span
        data-testid="bet-indicator"
        className="text-[10px] text-muted-foreground uppercase tracking-wide"
      >
        Settled
      </span>
    );
  } else if (match.isLocked) {
    node = (
      <span
        data-testid="bet-indicator"
        className="text-[10px] text-destructive uppercase tracking-wide font-medium"
      >
        Locked
      </span>
    );
  } else {
    // Pre-kickoff, not locked → show the countdown to lock time.
    node = (
      <span
        data-testid="bet-indicator"
        className="text-[10px] text-muted-foreground uppercase tracking-wide"
      >
        <Countdown
          kickoffTime={match.kickoffTime}
          lockdownMs={lockdownMs}
          serverNow={serverNow}
        />
      </span>
    );
  }
  return (
    <div className="px-1 py-1 flex items-center justify-end" aria-label="Bet indicator">
      {node}
    </div>
  );
}

/**
 * Game status badge. Rendered at the right side of the score row
 * with the same visual weight as the score (font-display + large
 * + bold). The label is, in priority order:
 *   1. `match.externalStatus` — the provider's raw status string
 *      ("HT", "2H 78'", "FT", "AET", "PEN", "NS"…). When the
 *      provider has a granular live-state code, that's more
 *      informative than the typed "GOING" / "FINISHED" labels.
 *   2. Fallback derived from `match.status`:
 *        - FINISHED → "Final"
 *        - GOING → "Live"
 *        - SCHEDULED → kickoff time, formatted in UTC
 *      (Format chosen to match the pre-ISC behaviour the
 *      principal was used to.)
 *
 * The badge is a <span> with the same font as the score so the
 * eye reads them as a pair. The colour stays neutral — the
 * top border on the card already encodes the status at a
 * glance, and the bet indicator row handles the "Locked" /
 * "Settled" warnings.
 */
function GameStatusBadge({ match }: { match: FeedMatch }) {
  let label: string;
  if (match.externalStatus) {
    label = match.externalStatus;
  } else if (match.status === "FINISHED") {
    label = "Final";
  } else if (match.status === "GOING") {
    label = "Live";
  } else {
    // SCHEDULED — show the kickoff time as the "when does the
    // game start" hint. formatUtc produces "Tue 09 Jun, 20:00
    // UTC" — short enough to fit on a single line next to the
    // score.
    label = formatUtc(match.kickoffTime);
  }
  return (
    <span
      data-testid="game-status"
      className="font-display font-bold text-base md:text-lg text-foreground shrink-0 tabular-nums whitespace-nowrap"
    >
      {label}
    </span>
  );
}

function ResultExtras({
  match,
  homeScore,
  awayScore,
}: {
  match: FeedMatch;
  homeScore: number | null;
  awayScore: number | null;
}) {
  if (match.status !== "FINISHED") return null;
  if (homeScore === null || awayScore === null) return null;
  const extras: string[] = [];
  if (match.homeHtGoals !== null && match.awayHtGoals !== null) {
    extras.push(`HT ${match.homeHtGoals}-${match.awayHtGoals}`);
  }
  if (match.homePenalties !== null && match.awayPenalties !== null) {
    extras.push(`${match.homePenalties}-${match.awayPenalties} pens`);
  }
  if (extras.length === 0) return null;
  return (
    <span className="ml-2 text-xs text-muted-foreground font-mono">
      ({extras.join(", ")})
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
