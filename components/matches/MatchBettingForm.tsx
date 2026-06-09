"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBetsBatchAction } from "@/app/(app)/groups/[groupId]/matches/actions";
import type { FeedMatch } from "@/lib/services/group-feed";

// ---- Human-readable label maps (PURELY COSMETIC) ---------------------------
// The underlying value, save-batch validation, and scoring strategies
// continue to use the canonical codes. Mutating these maps would
// break the save-batch validation and scoring strategy.
const IN_GAME_PENALTY_LABELS: Record<string, string> = {
  HOME: "Home team",
  AWAY: "Away team",
};

// Team names are truncated to 7 chars in chips; the full name is shown
// on hover via the `title` attribute. Used for IN_GAME_PENALTY chips
// (HOME / AWAY codes are canonical — display-only swap) and HALF_SCORING
// chips (A_1H / A_2H = home half, B_1H / B_2H = away half). Falls back
// to the static label map if the team name is missing (edge case).
const TEAM_NAME_MAX = 7;
function teamLabel(
  code: string,
  homeTeam: string | undefined,
  awayTeam: string | undefined,
): { display: string; fullName: string | null } {
  if (code === "HOME" && homeTeam) {
    return truncate(homeTeam);
  }
  if (code === "AWAY" && awayTeam) {
    return truncate(awayTeam);
  }
  return { display: IN_GAME_PENALTY_LABELS[code] ?? code, fullName: null };
}

// HALF_SCORING codes are team-based: A = home, B = away, 1H/2H = which
// half. The display is "<team> 1H" / "<team> 2H" with the team name
// truncated to 7 chars (truncation applies only to the team part —
// the " 1H"/" 2H" suffix is always appended). Falls back to "Home" /
// "Away" if the team name is missing.
const HALF_SCORING_FALLBACK: Record<string, string> = {
  A_1H: "Home 1H",
  A_2H: "Home 2H",
  B_1H: "Away 1H",
  B_2H: "Away 2H",
};
function halfScoringLabel(
  code: string,
  homeTeam: string | undefined,
  awayTeam: string | undefined,
): { display: string; fullName: string | null } {
  const half = code.endsWith("_2H") ? " 2H" : " 1H";
  if (code.startsWith("A_") && homeTeam) {
    const { display, fullName } = truncate(homeTeam);
    return { display: `${display}${half}`, fullName: `${fullName}${half}` };
  }
  if (code.startsWith("B_") && awayTeam) {
    const { display, fullName } = truncate(awayTeam);
    return { display: `${display}${half}`, fullName: `${fullName}${half}` };
  }
  return { display: HALF_SCORING_FALLBACK[code] ?? code, fullName: null };
}

function truncate(name: string): { display: string; fullName: string } {
  if (name.length <= TEAM_NAME_MAX) return { display: name, fullName: name };
  return { display: `${name.slice(0, TEAM_NAME_MAX)}…`, fullName: name };
}

// ---- Component -------------------------------------------------------------

export function MatchBettingForm({
  match,
  groupId,
}: {
  match: FeedMatch;
  groupId: string;
}) {
  const router = useRouter();
  const isLockedOrSettled =
    match.isLocked || match.status === "FINISHED";

  // Locate the three default markets (and tolerate a missing optional
  // market — e.g. on the OUTRIGHT match, no HALF_SCORING/IN_GAME_PENALTY).
  // OUTRIGHT_TEXT markets (e.g. "Who will win the tournament?") are
  // rendered separately below — the per-match form is designed for the
  // 3 standard markets, but OUTRIGHT matches still need a working
  // OUTRIGHT_TEXT picker.
  const exactScore = match.markets.find((m) => m.type === "EXACT_SCORE");
  const halfScoring = match.markets.find((m) => m.type === "HALF_SCORING");
  const inGamePenalty = match.markets.find(
    (m) => m.type === "IN_GAME_PENALTY",
  );
  const outrightMarkets = match.markets.filter(
    (m) =>
      m.type === "OUTRIGHT_TEXT" || m.type === "PROPOSITION_CHOICE",
  );

  // ---- Form state ---------------------------------------------------------
  // Track the current value of each market in a single picks map.
  // Keyed by marketId (the DB unique id) so we can submit a clean
  // { marketId: value } record to saveBetsBatch.
  const initialPicks = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const m of match.markets) {
      if (m.viewerBet) out[m.id] = m.viewerBet.predictedValue;
    }
    return out;
  }, [match.markets]);
  const [picks, setPicks] = useState<Record<string, string>>(initialPicks);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Save-button gating: EXACT_SCORE is required WHEN it exists on the
  // match. For OUTRIGHT matches (no EXACT_SCORE), the form just needs
  // at least one outright pick before saving. The action re-validates
  // server-side. The "correct winner" credit is folded into
  // EXACT_SCORE's scoring — no separate pick needed.
  const hasRequiredMatchPicks =
    !exactScore || !!picks[exactScore.id]?.trim();
  const hasAnyPick = Object.values(picks).some((v) => !!v?.trim());
  const canSave = hasRequiredMatchPicks && hasAnyPick;

  function setPick(marketId: string, value: string) {
    setPicks((prev) => ({ ...prev, [marketId]: value }));
  }

  function clearPick(marketId: string) {
    setPicks((prev) => {
      const { [marketId]: _drop, ...rest } = prev;
      return rest;
    });
  }

  function toggleHalfScoring(marketId: string, code: string) {
    setPicks((prev) => {
      const current = (prev[marketId] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const set = new Set(current);
      if (set.has(code)) {
        set.delete(code);
      } else {
        if (set.size >= 2) return prev;
        set.add(code);
      }
      return { ...prev, [marketId]: Array.from(set).join(",") };
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!canSave) {
      setError("Pick a final score before saving.");
      return;
    }
    startTransition(async () => {
      const result = await saveBetsBatchAction({
        groupId,
        matchId: match.id,
        picks,
      });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Failed to save");
      }
    });
  }

  // ---- Locked / settled: read-only display -------------------------------
  if (isLockedOrSettled) {
    return (
      <div className="space-y-3">
        {exactScore && (
          <LockedMarketRow
            title="Predict the final score"
            type="EXACT_SCORE"
            marketId={exactScore.id}
            savedValue={exactScore.viewerBet?.predictedValue ?? null}
            pointsAwarded={
              exactScore.isSettled
                ? exactScore.viewerBet?.pointsAwarded ?? null
                : null
            }
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
          />
        )}
        {outrightMarkets.map((m) => (
          <LockedMarketRow
            key={m.id}
            title={m.title}
            type={m.type}
            marketId={m.id}
            savedValue={m.viewerBet?.predictedValue ?? null}
            pointsAwarded={
              m.isSettled ? m.viewerBet?.pointsAwarded ?? null : null
            }
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
          />
        ))}
      </div>
    );
  }

  // ---- Editable form ------------------------------------------------------
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {exactScore && (
        <ExactScoreRow
          marketId={exactScore.id}
          value={picks[exactScore.id] ?? ""}
          onChange={(v) => setPick(exactScore.id, v)}
        />
      )}

      {outrightMarkets.map((m) => (
        <PropositionalRow
          key={m.id}
          marketId={m.id}
          title={m.title}
          type={m.type}
          options={m.options ?? []}
          value={picks[m.id] ?? ""}
          onChange={(v) => setPick(m.id, v)}
        />
      ))}

      <div className="flex items-center justify-between gap-3 pt-2">
      
        <button
          type="submit"
          disabled={isPending || !canSave}
          className="neon-button-flat px-5 py-2 text-sm disabled:opacity-50 disabled:pointer-events-none"
        >
          {isPending ? "Saving…" : "Save predictions"}
        </button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </form>
  );
}

// ---- Sub-rows -------------------------------------------------------------

function ExactScoreRow({
  marketId: _marketId,
  value,
  onChange,
}: {
  marketId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [h, a] = value ? value.split("-") : ["", ""];
  return (
    <div>
      <p className="text-sm font-medium">Predict the final score</p>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={99}
          value={h ?? ""}
          onChange={(e) => onChange(`${e.target.value || 0}-${a ?? 0}`)}
          placeholder="0"
          className="w-16 rounded-xl bg-background/40 border border-border p-2 text-center focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
        <span className="text-muted-foreground font-mono">—</span>
        <input
          type="number"
          min={0}
          max={99}
          value={a ?? ""}
          onChange={(e) => onChange(`${h ?? 0}-${e.target.value || 0}`)}
          placeholder="0"
          className="w-16 rounded-xl bg-background/40 border border-border p-2 text-center focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
      </div>
    </div>
  );
}

function HalfScoringRow({
  marketId: _marketId,
  options,
  value,
  onToggle,
  homeTeam,
  awayTeam,
}: {
  marketId: string;
  options: string[];
  value: string;
  onToggle: (code: string) => void;
  homeTeam: string;
  awayTeam: string;
}) {
  const selected = useMemo(
    () =>
      new Set(
        value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    [value],
  );
  return (
    <div>
      <p className="text-sm font-medium">Which teams score in which half?</p>
      <p className="text-[11px] text-muted-foreground mb-2">
        Optional — Pick 1 or 2 — +1 per correct, -1 per wrong (min -1)
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {options.map((opt) => {
          const isSelected = selected.has(opt);
          const isAtCap = !isSelected && selected.size >= 2;
          const { display, fullName } = halfScoringLabel(opt, homeTeam, awayTeam);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              disabled={isAtCap}
              title={fullName ?? undefined}
              className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                isSelected
                  ? "bg-primary/20 border-primary"
                  : isAtCap
                  ? "bg-background/20 border-border text-muted-foreground opacity-50 cursor-not-allowed"
                  : "bg-background/40 border-border hover:bg-background/60"
              }`}
            >
              {display}
            </button>
          );
        })}
        <span className="text-xs text-muted-foreground font-mono ml-1">
          {selected.size}/2 selected
        </span>
      </div>
    </div>
  );
}

function InGamePenaltyRow({
  marketId: _marketId,
  options,
  value,
  onChange,
  onClear,
  homeTeam,
  awayTeam,
}: {
  marketId: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  homeTeam: string;
  awayTeam: string;
}) {
  return (
    <div>
      <p className="text-sm font-medium">Which team gets an in-game penalty?</p>
      <p className="text-[11px] text-muted-foreground mb-2">
        Optional — +3 for correct, -2 for wrong (min -1)
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {options.map((opt) => {
          const { display, fullName } = teamLabel(opt, homeTeam, awayTeam);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              title={fullName ?? undefined}
              className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                value === opt
                  ? "bg-primary/20 border-primary"
                  : "bg-background/40 border-border hover:bg-background/60"
              }`}
            >
              {display}
            </button>
          );
        })}
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function PropositionalRow({
  marketId: _marketId,
  title,
  type,
  options,
  value,
  onChange,
}: {
  marketId: string;
  title: string;
  type: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  // OUTRIGHT_TEXT (e.g. "Who will win the tournament?") is free-form
  // unless the seed JSON supplied an options list. PROPOSITION_CHOICE
  // is always option-restricted. Render a chip picker if there are
  // options, otherwise a free-form text input.
  if (options.length > 0) {
    return (
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mb-2">Pick one</p>
        <div className="flex items-center gap-2 flex-wrap">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                value === opt
                  ? "bg-primary/20 border-primary"
                  : "bg-background/40 border-border hover:bg-background/60"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (type === "PROPOSITION_CHOICE") {
    return null; // required to pick from options; if none, render nothing
  }
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mb-2">Type your pick</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your pick…"
        maxLength={64}
        className="flex-1 rounded-xl bg-background/40 border border-border p-2 focus:outline-none focus:ring-2 focus:ring-ring/50"
      />
    </div>
  );
}

// ---- Locked-row component -------------------------------------------------

function LockedMarketRow({
  title,
  type,
  savedValue,
  pointsAwarded,
  homeTeam,
  awayTeam,
}: {
  title: string;
  type: string;
  marketId: string;
  savedValue: string | null;
  pointsAwarded: number | null;
  homeTeam: string;
  awayTeam: string;
}) {
  return (
    <div className="rounded-xl bg-background/40 border border-border p-3 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">
        {savedValue
          ? <>Your pick: <span className="font-mono text-foreground">{formatValue(type, savedValue, homeTeam, awayTeam)}</span></>
          : "No prediction placed."}
        {pointsAwarded !== null && (
          <>
            {" "}
            <span
              className={
                pointsAwarded > 0
                  ? "text-success font-bold"
                  : pointsAwarded < 0
                  ? "text-destructive font-bold"
                  : "text-muted-foreground"
              }
            >
              ({formatPoints(pointsAwarded)})
            </span>
          </>
        )}
      </p>
    </div>
  );
}

// ---- Helpers --------------------------------------------------------------

function formatValue(
  type: string,
  value: string,
  homeTeam?: string,
  awayTeam?: string,
): string {
  if (type === "EXACT_SCORE") return value.replace("-", " — ");
  if (type === "HALF_SCORING") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((code) => halfScoringLabel(code, homeTeam, awayTeam).display)
      .join(" + ");
  }
  if (type === "IN_GAME_PENALTY") {
    return teamLabel(value, homeTeam, awayTeam).display;
  }
  return value;
}

function formatPoints(p: number): string {
  if (p > 0) return `+${p} pts`;
  if (p < 0) return `${p} pts`;
  return "0 pts";
}
