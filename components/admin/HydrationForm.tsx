"use client";

import { useState, useTransition } from "react";
import { syncCompetitionAction, type SyncActionResult } from "@/app/(app)/admin/actions";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; result: SyncActionResult };

export function HydrationForm() {
  const [json, setJson] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJson(text);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!json.trim()) return;

    setState({ kind: "loading" });
    startTransition(async () => {
      const result = await syncCompetitionAction(json);
      setState({ kind: "done", result });
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="pitch-card p-6 space-y-4">
        <div>
          <label
            htmlFor="json-input"
            className="micro-tag block mb-2"
          >
            Competition JSON
          </label>
          <textarea
            id="json-input"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={14}
            placeholder='{ "competition": { "name": "World Cup 2026" }, "matches": [...] }'
            className="w-full rounded-xl bg-background/40 border border-border p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring/50"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <label className="pitch-card px-4 py-2 cursor-pointer hover:-translate-y-0.5 transition-transform text-sm">
            <span className="micro-tag mr-2">Upload</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleFile}
              className="hidden"
            />
            .json file
          </label>

          <button
            type="submit"
            disabled={isPending || !json.trim()}
            className="neon-button inline-flex items-center justify-center px-6 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {isPending ? "Syncing…" : "Sync"}
          </button>
        </div>
      </form>

      {state.kind === "done" && <ResultPanel result={state.result} />}
    </div>
  );
}

function ResultPanel({ result }: { result: SyncActionResult }) {
  if (!result.ok) {
    return (
      <div className="pitch-card p-6 border-destructive/50">
        <p className="micro-tag text-destructive mb-2">Error</p>
        <p className="font-mono text-sm">{result.error}</p>
        {result.issues != null && (
          <pre className="mt-3 text-xs bg-background/40 p-3 rounded overflow-auto max-h-64">
            {JSON.stringify(result.issues, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  const r = result.result!;
  return (
    <div className="pitch-card p-6">
      <p className="micro-tag mb-2">Result</p>
      <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
        <div>
          <p className="text-muted-foreground">Matches created</p>
          <p className="font-display text-2xl font-bold">{r.created.matches}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Matches updated</p>
          <p className="font-display text-2xl font-bold">{r.updated.matches}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Markets created</p>
          <p className="font-display text-2xl font-bold">{r.created.markets}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Markets updated</p>
          <p className="font-display text-2xl font-bold">{r.updated.markets}</p>
        </div>
      </div>
      {r.errors.length > 0 && (
        <div className="mt-4">
          <p className="text-destructive text-sm mb-2">
            {r.errors.length} errors:
          </p>
          <pre className="text-xs bg-background/40 p-3 rounded overflow-auto max-h-48">
            {JSON.stringify(r.errors, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
