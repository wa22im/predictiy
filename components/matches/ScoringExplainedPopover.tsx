"use client";

import { useEffect, useState } from "react";
import { SCORING_EXAMPLES, type ScoringExample } from "@/lib/services/scoring-examples";

export function ScoringExplainedPopover({
  label = "!",
}: {
  label?: string;
} = {}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        aria-label="How is the score calculated?"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={
          label === "!"
            ? "inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background/40 text-[10px] font-bold text-muted-foreground hover:bg-background/60 hover:text-foreground transition-colors"
            : "command-strip-flat text-xs"
        }
      >
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Scoring examples"
            className="paper-card p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="micro-label">How scoring works</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              7 examples — group stage uses +3 / +1 weights, knockout uses +5 / +2. Every bet is
              floored at -1, so a single bad pick can never cost you more than -1.
            </p>
            <div className="space-y-3 pr-1">
              {SCORING_EXAMPLES.map((ex, i) => (
                <ExampleBlock key={i} example={ex} index={i + 1} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExampleBlock({ example, index }: { example: ScoringExample; index: number }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 text-xs space-y-10">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-bold text-foreground">
          {index}. {example.title}
        </p>
        <span className="micro-label text-[10px]">{example.stage}</span>
      </div>
      <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px]">
        <dt className="text-muted-foreground">Match</dt>
        <dd className="text-foreground">{example.match}</dd>
        <dt className="text-muted-foreground">Your bet</dt>
        <dd className="text-foreground">
          EXACT {example.userBet.exactScore} · HALF {example.userBet.halfScoring || "—"} · PEN{" "}
          {example.userBet.inGamePenalty || "—"}
        </dd>
        <dt className="text-muted-foreground">Result</dt>
        <dd className="text-foreground">
          {example.result.finalScore} ({example.result.winner}) · HALF{" "}
          {example.result.halfScoring} · PEN {example.result.inGamePenalty}
        </dd>
      </dl>
      <ul className="space-y-0.5">
        {example.breakdown.map((row) => (
          <li key={row.market} className="flex items-baseline gap-2 text-[11px]">
            <span
              className={
                row.points > 0
                  ? "text-emerald-400 font-mono font-bold w-8 text-right shrink-0"
                  : row.points < 0
                  ? "text-destructive font-mono font-bold w-8 text-right shrink-0"
                  : "text-muted-foreground font-mono font-bold w-8 text-right shrink-0"
              }
            >
              {formatPoints(row.points)}
            </span>
            <span className="text-foreground">
              <span className="font-bold">{row.market}:</span> {row.note}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground border-t border-border pt-1.5">
        <span className="font-mono font-bold text-foreground">Total: {formatPoints(example.total)}</span>{" "}
        — {example.explanation}
      </p>
    </div>
  );
}

function formatPoints(p: number): string {
  if (p > 0) return `+${p}`;
  return `${p}`;
}
