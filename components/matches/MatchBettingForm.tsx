"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBetsBatchAction } from "@/app/(app)/groups/[groupId]/matches/actions";
import type { FeedMatch } from "@/lib/services/group-feed";

// ---- Human-readable label maps (PURELY COSMETIC) ---------------------------
// The underlying value, save-batch validation, and scoring strategies
// continue to use the canonical codes. Mutating these maps would
// break the save-batch validation and scoring strategy.
const HALF_SCORING_LABELS: Record<string, string> = {
  A_1H: "Home 1H",
  A_2H: "Home 2H",
  B_1H: "Away 1H",
  B_2H: "Away 2H",
};

const IN_GAME_PENALTY_LABELS: Record<string, string> = {
  HOME: "Home team",
  AWAY: "Away team",
};

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
          />
        )}
        {halfScoring && (
          <LockedMarketRow
            title="Which teams score in which half?"
            type="HALF_SCORING"
            marketId={halfScoring.id}
            savedValue={halfScoring.viewerBet?.predictedValue ?? null}
            pointsAwarded={
              halfScoring.isSettled
                ? halfScoring.viewerBet?.pointsAwarded ?? null
                : null
            }
          />
        )}
        {inGamePenalty && (
          <LockedMarketRow
            title="Which team gets an in-game penalty?"
            type="IN_GAME_PENALTY"
            marketId={inGamePenalty.id}
            savedValue={inGamePenalty.viewerBet?.predictedValue ?? null}
            pointsAwarded={
              inGamePenalty.isSettled
                ? inGamePenalty.viewerBet?.pointsAwarded ?? null
                : null
            }
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

      {halfScoring && (
        <HalfScoringRow
          marketId={halfScoring.id}
          options={halfScoring.options ?? []}
          value={picks[halfScoring.id] ?? ""}
          onToggle={(code) => toggleHalfScoring(halfScoring.id, code)}
        />
      )}

      {inGamePenalty && (
        <InGamePenaltyRow
          marketId={inGamePenalty.id}
          options={inGamePenalty.options ?? []}
          value={picks[inGamePenalty.id] ?? ""}
          onChange={(v) => setPick(inGamePenalty.id, v)}
          onClear={() => clearPick(inGamePenalty.id)}
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
        <p className="text-xs text-muted-foreground">
          Optional: skip the chips you don&apos;t want to bet on.
        </p>
        <button
          type="submit"
          disabled={isPending || !canSave}
          className="command-strip px-5 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
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
      <p className="text-xs text-muted-foreground mb-2">
        Required — +3 for exact, +1 for correct winner (group); +5 / +2 (knockout). 0 if wrong.
      </p>
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
}: {
  marketId: string;
  options: string[];
  value: string;
  onToggle: (code: string) => void;
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
        Optional — Pick 2 — +1 per correct, -1 per wrong (min -1)
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {options.map((opt) => {
          const isSelected = selected.has(opt);
          const isAtCap = !isSelected && selected.size >= 2;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              disabled={isAtCap}
              className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                isSelected
                  ? "bg-primary/20 border-primary"
                  : isAtCap
                  ? "bg-background/20 border-border text-muted-foreground opacity-50 cursor-not-allowed"
                  : "bg-background/40 border-border hover:bg-background/60"
              }`}
            >
              {HALF_SCORING_LABELS[opt] ?? opt}
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
}: {
  marketId: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium">Which team gets an in-game penalty?</p>
      <p className="text-[11px] text-muted-foreground mb-2">
        Optional — +3 for correct, -2 for wrong (min -1)
      </p>
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
            {IN_GAME_PENALTY_LABELS[opt] ?? opt}
          </button>
        ))}
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
}: {
  title: string;
  type: string;
  marketId: string;
  savedValue: string | null;
  pointsAwarded: number | null;
}) {
  return (
    <div className="rounded-xl bg-background/40 border border-border p-3 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">
        {savedValue
          ? <>Your pick: <span className="font-mono text-foreground">{formatValue(type, savedValue)}</span></>
          : "No prediction placed."}
        {pointsAwarded !== null && (
          <>
            {" "}
            <span
              className={
                pointsAwarded > 0
                  ? "text-emerald-400 font-bold"
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

function formatValue(type: string, value: string): string {
  if (type === "EXACT_SCORE") return value.replace("-", " — ");
  if (type === "HALF_SCORING") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((code) => HALF_SCORING_LABELS[code] ?? code)
      .join(" + ");
  }
  if (type === "IN_GAME_PENALTY") {
    return IN_GAME_PENALTY_LABELS[value] ?? value;
  }
  return value;
}

function formatPoints(p: number): string {
  if (p > 0) return `+${p} pts`;
  if (p < 0) return `${p} pts`;
  return "0 pts";
}
