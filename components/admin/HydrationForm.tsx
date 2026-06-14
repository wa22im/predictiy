"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { syncCompetitionAction, type SyncActionResult } from "@/app/(app)/admin/actions";

// Full, canonical reference for the hydration terminal.
// MARKET TYPES — see /admin/leagues for which are currently active.
// EXACT_SCORE is auto-settled; HALF_SCORING and IN_GAME_PENALTY are disabled (Phase 10.9).
const FULL_EXAMPLE_JSON = `{
  "competition": {
    "name": "World Cup 2026 — Group Stage (Demo)"
  },
  "matches": [
    {
      "apiMatchId": "wc2026-grpA-m1",
      "homeTeam": "Qatar",
      "awayTeam": "Ecuador",
      "homeCrest": "https://example.com/crest-qatar.png",
      "awayCrest": "https://example.com/crest-ecuador.png",
      "kickoffTime": "2026-06-15T18:00:00.000Z",
      "stage": "GROUP_STAGE",
      "markets": [
        {
          "type": "EXACT_SCORE",
          "title": "Final score",
          "options": ["1-0", "2-0", "2-1", "0-0", "1-1", "0-1", "0-2", "1-2"]
        },
        {
          "type": "HALF_SCORING",
          "title": "Half-time scoring",
          "options": ["1-0", "0-0", "0-1", "2-1"]
        },
        {
          "type": "IN_GAME_PENALTY",
          "title": "Penalty in the match?",
          "options": ["Yes", "No"]
        }
      ]
    },
    {
      "apiMatchId": "wc2026-grpA-m2",
      "homeTeam": "Senegal",
      "awayTeam": "Netherlands",
      "kickoffTime": "2026-06-15T21:00:00.000Z",
      "stage": "GROUP_STAGE",
      "markets": [
        {
          "type": "EXACT_SCORE",
          "title": "Final score",
          "options": ["0-1", "0-2", "1-2", "1-3"]
        },
        {
          "type": "PROPOSITION_CHOICE",
          "title": "First goalscorer",
          "options": ["Sadio Mane", "Cody Gakpo", "No goalscorer"]
        }
      ]
    },
    {
      "apiMatchId": "wc2026-final",
      "homeTeam": "TBD",
      "awayTeam": "TBD",
      "kickoffTime": "2026-07-19T20:00:00.000Z",
      "stage": "FINAL",
      "markets": [
        {
          "type": "EXACT_SCORE",
          "title": "Final score",
          "options": ["0-0", "1-0", "0-1", "1-1", "2-1", "1-2"]
        }
      ]
    }
  ]
}`;

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; result: SyncActionResult };

export function HydrationForm() {
  const [json, setJson] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJson(text);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(FULL_EXAMPLE_JSON);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts; fall back to selection.
      const ta = document.createElement("textarea");
      ta.value = FULL_EXAMPLE_JSON;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
      <details className="pitch-card p-6 group">
        <summary className="cursor-pointer flex items-center justify-between gap-3 list-none">
          <span className="flex items-center gap-2">
            <span className="micro-tag">Reference</span>
            <span className="text-sm font-medium">
              Full JSON example (copyable)
            </span>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void handleCopy();
              }}
              className="neon-button-flat inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold"
              aria-label="Copy example JSON to clipboard"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy
                </>
              )}
            </button>
            <span
              aria-hidden="true"
              className="text-xs text-muted-foreground transition-transform group-open:rotate-180"
            >
              ▼
            </span>
          </span>
        </summary>
        <p className="mt-3 text-xs text-muted-foreground">
          MARKET TYPES — see <code>/admin/leagues</code> for which are currently
          active. <code>EXACT_SCORE</code> is auto-settled;{" "}
          <code>HALF_SCORING</code> and <code>IN_GAME_PENALTY</code> are disabled
          (Phase 10.9). The example below exercises all four market types and
          shows the optional <code>homeCrest</code> / <code>awayCrest</code> URL
          fields.
        </p>
        <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-background/40 border border-border p-3 font-mono text-xs leading-relaxed">
          {FULL_EXAMPLE_JSON}
        </pre>
      </details>

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
