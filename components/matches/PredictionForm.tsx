"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBetAction } from "@/app/(app)/groups/[groupId]/matches/actions";
import type { FeedMarket } from "@/lib/services/group-feed";

// Human-readable labels for the canonical codes stored in BetMarket.options
// and UserBet.predictedValue. PURELY COSMETIC — the value state, save-bet
// validation, and scoring strategies continue to use the canonical codes.
// Mutating these maps would break the save-bet validation and scoring
// strategy, which both key off the raw codes.
export const HALF_SCORING_LABELS: Record<string, string> = {
  A_1H: "Home 1H",
  A_2H: "Home 2H",
  B_1H: "Away 1H",
  B_2H: "Away 2H",
};

export const IN_GAME_PENALTY_LABELS: Record<string, string> = {
  HOME: "Home team",
  AWAY: "Away team",
  NONE: "No penalty",
};

export function PredictionForm({
  market,
  groupId,
  matchLocked,
}: {
  market: FeedMarket;
  groupId: string;
  matchLocked: boolean;
}) {
  const router = useRouter();
  const initial = market.viewerBet?.predictedValue ?? "";
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // For EXACT_SCORE the underlying value is "X-Y"; render as two inputs
  const [home, away] =
    market.type === "EXACT_SCORE" && initial
      ? initial.split("-")
      : ["", ""];

  const [h, setH] = useState(home);
  const [a, setA] = useState(away);

  // HALF_SCORING is multi-select: value is a comma-separated set of up
  // to 2 codes from the market's options. We reuse the same `value`
  // string state and derive a Set for rendering.
  const isHalfScoring = market.type === "HALF_SCORING";
  const selectedSet = useMemo(() => {
    if (!isHalfScoring) return new Set<string>();
    return new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  }, [isHalfScoring, value]);

  function toggleHalfScoringOption(opt: string) {
    setValue((prev) => {
      const current = new Set(
        prev
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
      if (current.has(opt)) {
        current.delete(opt);
      } else {
        if (current.size >= 2) return prev;
        current.add(opt);
      }
      return Array.from(current).join(",");
    });
  }

  function buildPayload(): string {
    if (market.type === "EXACT_SCORE") {
      return `${h || 0}-${a || 0}`;
    }
    return value.trim();
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const payload = buildPayload();
    if (!payload) return;

    startTransition(async () => {
      const result = await saveBetAction({
        groupId,
        marketId: market.id,
        predictedValue: payload,
      });
      if (result.ok) {
        setValue(payload);
        router.refresh();
      } else {
        setError(result.error ?? "Failed to save");
      }
    });
  }

  if (matchLocked) {
    return (
      <div className="rounded-xl bg-background/40 border border-border p-3 text-sm text-muted-foreground">
        {market.viewerBet
          ? <>Your pick: <span className="font-mono text-foreground">{formatValue(market.type, market.viewerBet.predictedValue)}</span></>
          : "No prediction placed."}
      </div>
    );
  }

  // PROPOSITION_CHOICE and IN_GAME_PENALTY are single-select chip pickers.
  const isProposition =
    market.type === "PROPOSITION_CHOICE" ||
    market.type === "IN_GAME_PENALTY";

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {market.type === "EXACT_SCORE" && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={99}
            value={h}
            onChange={(e) => setH(e.target.value)}
            placeholder="0"
            className="w-16 rounded-xl bg-background/40 border border-border p-2 text-center focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          <span className="text-muted-foreground font-mono">—</span>
          <input
            type="number"
            min={0}
            max={99}
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder="0"
            className="w-16 rounded-xl bg-background/40 border border-border p-2 text-center focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          <button
            type="submit"
            disabled={isPending}
            className="command-strip px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPending ? "Saving…" : market.viewerBet ? "Update" : "Save"}
          </button>
        </div>
      )}

      {market.type === "OUTRIGHT_TEXT" && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type your pick…"
            maxLength={64}
            className="flex-1 rounded-xl bg-background/40 border border-border p-2 focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          <button
            type="submit"
            disabled={isPending || !value.trim()}
            className="command-strip px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPending ? "Saving…" : market.viewerBet ? "Update" : "Save"}
          </button>
        </div>
      )}

      {isProposition && (
        <div className="flex items-center gap-2 flex-wrap">
          {(market.options ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setValue(opt)}
              className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                value === opt
                  ? "bg-primary/20 border-primary"
                  : "bg-background/40 border-border hover:bg-background/60"
              }`}
            >
              {market.type === "IN_GAME_PENALTY"
                ? IN_GAME_PENALTY_LABELS[opt] ?? opt
                : opt}
            </button>
          ))}
          <button
            type="submit"
            disabled={isPending || !value.trim()}
            className="command-strip px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPending ? "Saving…" : market.viewerBet ? "Update" : "Save"}
          </button>
        </div>
      )}

      {isHalfScoring && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-mono">
            Pick 2 — {selectedSet.size}/2 selected
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {(market.options ?? []).map((opt) => {
              const isSelected = selectedSet.has(opt);
              const isAtCap = !isSelected && selectedSet.size >= 2;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleHalfScoringOption(opt)}
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
            <button
              type="submit"
              disabled={isPending || selectedSet.size === 0}
              className="command-strip px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
            >
              {isPending ? "Saving…" : market.viewerBet ? "Update" : "Save"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}
    </form>
  );
}

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
