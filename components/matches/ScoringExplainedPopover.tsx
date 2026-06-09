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
            : "neon-button-flat text-xs"
        }
      >
        {label}
      </button>
      {open && (
        <div
 className="fixed inset-0 z-50 overflow-y-auto bg-overlay backdrop-blur-sm"
           onClick={() => setOpen(false)}
        >
            <div className="min-h-full flex items-start justify-center p-4 sm:p-6">
          <div
            role="dialog"
            aria-label="Scoring examples"
            className="pitch-card p-6 max-w-2xl w-full scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="micro-tag">How scoring works</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground mb-3">
              Stage-dependent scoring: the more decisive the match, the more you
              can win. In the{" "}
              <span className="font-bold text-foreground">group stage</span> an
              exact score is worth <span className="font-bold text-foreground">+5</span>{" "}
              (non-draw) or <span className="font-bold text-foreground">+5</span>{" "}
              (draw), with +2 for any draw score on a draw game, +2 for the right
              winner + right goal difference, +1 for the right winner only, and 0
              for a miss. In the{" "}
              <span className="font-bold text-foreground">knockout rounds</span>{" "}
              (R16, QF, SF, 3rd, F) every tier is bumped up:{" "}
              <span className="font-bold text-foreground">+7</span> exact
              non-draw, <span className="font-bold text-foreground">+6</span>{" "}
              exact draw, <span className="font-bold text-foreground">+3</span>{" "}
              for any draw score on a draw game,{" "}
              <span className="font-bold text-foreground">+3</span> for the
              right winner + right goal difference,{" "}
              <span className="font-bold text-foreground">+2</span> for the
              right winner only, and 0 for a miss.
            </div>
            <div className="space-y-3"> {/* Changed from space-y-3 to match examples spacing */}
              {SCORING_EXAMPLES.map((ex, i) => (
                <ExampleBlock key={i} example={ex} index={i + 1} />
              ))}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExampleBlock({ example, index }: { example: ScoringExample; index: number }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2"> {/* Changed from space-y-10 to space-y-2 */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-bold text-foreground">
          {index}. {example.title}
        </p>
        <span className="micro-tag text-[10px]">{example.stage}</span>
      </div>
      <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px]">
        <dt className="text-muted-foreground">Match</dt>
        <dd className="text-foreground">{example.match}</dd>
        <dt className="text-muted-foreground">Your bet</dt>
        <dd className="text-foreground">EXACT {example.userBet.exactScore}</dd>
        <dt className="text-muted-foreground">Result</dt>
        <dd className="text-foreground">
          {example.result.finalScore} ({example.result.winner})
        </dd>
      </dl>
      <ul className="space-y-0.5">
        {example.breakdown.map((row) => (
          <li key={row.market} className="flex items-baseline gap-2 text-[11px]">
            <span
              className={
                row.points > 0
                  ? "text-success font-mono font-bold w-8 text-right shrink-0"
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