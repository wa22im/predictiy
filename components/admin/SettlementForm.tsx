"use client";

import { useState, useTransition } from "react";
import {
  settleMarketAction,
  type SettleActionResult,
} from "@/app/(app)/admin/settlement/actions";

type UnsettledMarket = {
  id: string;
  type: string;
  title: string;
  options: string[] | null;
  match: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    kickoffTime: string;
    stage: string;
    competitionName: string;
  } | null;
};

export function SettlementForm({
  unsettled,
}: {
  unsettled: UnsettledMarket[];
}) {
  const [results, setResults] = useState<Record<string, SettleActionResult>>(
    {},
  );
  const [isPending, startTransition] = useTransition();

  if (unsettled.length === 0) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No unsettled markets. Everything&apos;s been scored.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unsettled.map((m) => (
        <SettlementRow
          key={m.id}
          market={m}
          result={results[m.id]}
          isPending={isPending}
          startTransition={startTransition}
          onSettled={(r) => setResults((prev) => ({ ...prev, [m.id]: r }))}
        />
      ))}
    </div>
  );
}

function SettlementRow({
  market,
  result,
  isPending,
  startTransition,
  onSettled,
}: {
  market: UnsettledMarket;
  result?: SettleActionResult;
  isPending: boolean;
  startTransition: (cb: () => void) => void;
  onSettled: (r: SettleActionResult) => void;
}) {
  const placeholder = placeholderFor(market);
  const [value, setValue] = useState("");

  function handleSettle() {
    if (!value.trim()) return;
    startTransition(() => {
      void (async () => {
        const r = await settleMarketAction({
          marketId: market.id,
          correctAnswer: value.trim(),
        });
        onSettled(r);
      })();
    });
  }

  return (
    <article className="paper-card p-4 space-y-3">
      <div>
        <p className="micro-label mb-1">{market.match?.competitionName ?? "—"}</p>
        <p className="font-display text-lg font-bold tracking-tight">
          {market.match
            ? `${market.match.homeTeam} vs ${market.match.awayTeam}`
            : "Outright Market"}
        </p>
        <p className="text-sm text-muted-foreground">
          {market.title} ·{" "}
          <span className="font-mono text-xs">{market.type}</span>
        </p>
      </div>

      {result?.ok ? (
        <ResultPanel result={result} />
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 min-w-0 rounded-xl bg-background/40 border border-border p-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          <button
            type="button"
            onClick={handleSettle}
            disabled={isPending || !value.trim()}
            className="command-strip px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPending ? "Settling…" : "Settle"}
          </button>
        </div>
      )}

      {result && !result.ok && (
        <p className="text-destructive text-sm">{result.error}</p>
      )}
    </article>
  );
}

function ResultPanel({ result }: { result: SettleActionResult }) {
  const r = result.result as {
    marketId: string;
    correctAnswer: string;
    scoredRows: number;
    byGroup: Array<{
      groupId: string;
      groupName: string;
      scoredRows: number;
      totalPoints: number;
    }>;
  };

  return (
    <div className="rounded-xl bg-background/40 border border-border p-3 text-sm space-y-2">
      <p className="text-xs">
        ✓ Settled.{" "}
        <span className="font-mono text-foreground">{r.correctAnswer}</span> ·
        <span className="text-muted-foreground"> {r.scoredRows} bets scored</span>
      </p>
      {r.byGroup.length > 0 && (
        <ul className="text-xs space-y-1">
          {r.byGroup.map((g) => (
            <li key={g.groupId} className="flex justify-between">
              <span>{g.groupName}</span>
              <span className="font-mono text-muted-foreground">
                {g.scoredRows} bet{g.scoredRows === 1 ? "" : "s"} · {g.totalPoints} pts
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function placeholderFor(market: UnsettledMarket): string {
  if (market.type === "EXACT_SCORE") return "e.g. 2-1";
  if (market.type === "PROPOSITION_CHOICE" && market.options) {
    return `e.g. ${market.options[0]}`;
  }
  return "e.g. Argentina";
}
