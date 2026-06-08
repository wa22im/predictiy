"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBetAction } from "@/app/(app)/groups/[groupId]/matches/actions";
import type { FeedMarket } from "@/lib/services/group-feed";

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

  // HT_FT and PENALTY_SHOOTOUT are proposition-style — pick from a
  // fixed set of options stored on the market row.
  const isProposition =
    market.type === "PROPOSITION_CHOICE" ||
    market.type === "HT_FT" ||
    market.type === "PENALTY_SHOOTOUT";

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
              {opt}
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

      {error && <p className="text-destructive text-xs">{error}</p>}
    </form>
  );
}

function formatValue(type: string, value: string): string {
  if (type === "EXACT_SCORE") return value.replace("-", " — ");
  return value;
}
