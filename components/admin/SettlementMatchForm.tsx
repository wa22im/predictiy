"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatUtc } from "@/lib/time";

export type SettlementMatchFormInitial = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  stage: string;
  status: "SCHEDULED" | "GOING" | "FINISHED";
  homeScore: number | null;
  awayScore: number | null;
  homeHtGoals: number | null;
  awayHtGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  /** True iff the match has at least one settled market. Used for the
   *  "Locked — auto-settled" badge — the form is still editable. */
  hasSettledMarkets: boolean;
};

type SaveResult = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Populated when ok === true. Mirrors the API response shape. */
  data?: {
    matchId: string;
    match: {
      id: string;
      status: string;
      homeScore: number | null;
      awayScore: number | null;
      homeHtGoals: number | null;
      awayHtGoals: number | null;
      homePenalties: number | null;
      awayPenalties: number | null;
    };
    transitionedToFinished: boolean;
    settlements: Array<{
      marketId: string;
      marketType: string;
      correctAnswer: string;
      scoredRows: number;
      byGroup: Array<{
        groupId: string;
        groupName: string;
        scoredRows: number;
        totalPoints: number;
      }>;
    }>;
    warnings: string[];
  };
};

export function SettlementMatchForm({
  match,
}: {
  match: SettlementMatchFormInitial;
}) {
  const router = useRouter();

  const [status, setStatus] = useState(match.status);
  const [homeScore, setHomeScore] = useState(
    match.homeScore === null ? "" : String(match.homeScore),
  );
  const [awayScore, setAwayScore] = useState(
    match.awayScore === null ? "" : String(match.awayScore),
  );
  const [homeHtGoals, setHomeHtGoals] = useState(
    match.homeHtGoals === null ? "" : String(match.homeHtGoals),
  );
  const [awayHtGoals, setAwayHtGoals] = useState(
    match.awayHtGoals === null ? "" : String(match.awayHtGoals),
  );
  const [homePenalties, setHomePenalties] = useState(
    match.homePenalties === null ? "" : String(match.homePenalties),
  );
  const [awayPenalties, setAwayPenalties] = useState(
    match.awayPenalties === null ? "" : String(match.awayPenalties),
  );

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  // Derived 2H goals — read-only display, always shown.
  const home2H = useMemo(() => {
    const f = homeScore === "" ? null : Number(homeScore);
    const h = homeHtGoals === "" ? null : Number(homeHtGoals);
    if (f === null || h === null) return null;
    return f - h;
  }, [homeScore, homeHtGoals]);
  const away2H = useMemo(() => {
    const f = awayScore === "" ? null : Number(awayScore);
    const h = awayHtGoals === "" ? null : Number(awayHtGoals);
    if (f === null || h === null) return null;
    return f - h;
  }, [awayScore, awayHtGoals]);

  // Locked = FINISHED + at least one market was auto-settled by an
  // earlier update. The form remains editable for corrections.
  const isLocked = match.status === "FINISHED" && match.hasSettledMarkets;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setResult(null);
    try {
      const toInt = (v: string) => (v === "" ? null : Number(v));
      const res = await fetch("/api/v1/admin/matches/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: match.id,
          status,
          homeScore: toInt(homeScore),
          awayScore: toInt(awayScore),
          homeHtGoals: toInt(homeHtGoals),
          awayHtGoals: toInt(awayHtGoals),
          homePenalties: toInt(homePenalties),
          awayPenalties: toInt(awayPenalties),
        }),
      });
      const json = (await res.json()) as SaveResult["data"] & {
        error?: string;
      };
      if (!res.ok) {
        setResult({
          ok: false,
          error: json.error ?? `HTTP ${res.status}`,
          message: (json as { message?: string }).message,
        });
        return;
      }
      setResult({ ok: true, data: json });
      router.refresh();
    } catch (err) {
      setResult({
        ok: false,
        error: (err as Error).message ?? "Network error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="pitch-card p-3 md:p-4 space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-base md:text-lg font-bold tracking-tight">
            {match.homeTeam} vs {match.awayTeam}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {formatUtc(match.kickoffTime)} · {match.stage}
          </p>
        </div>
        {isLocked && (
          <span className="micro-tag text-muted-foreground shrink-0">
            Locked — auto-settled
          </span>
        )}
      </header>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "SCHEDULED" | "GOING" | "FINISHED")
              }
              disabled={saving}
              className="rounded-lg bg-background/40 border border-border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            >
              <option value="SCHEDULED">SCHEDULED</option>
              <option value="GOING">GOING</option>
              <option value="FINISHED">FINISHED</option>
            </select>
          </label>
          <NumField
            label="Home"
            value={homeScore}
            onChange={setHomeScore}
            disabled={saving}
          />
          <NumField
            label="Away"
            value={awayScore}
            onChange={setAwayScore}
            disabled={saving}
          />
          <NumField
            label="HT Home"
            value={homeHtGoals}
            onChange={setHomeHtGoals}
            disabled={saving}
          />
          <NumField
            label="HT Away"
            value={awayHtGoals}
            onChange={setAwayHtGoals}
            disabled={saving}
          />
          <NumField
            label="Pen Home"
            value={homePenalties}
            onChange={setHomePenalties}
            disabled={saving}
          />
          <NumField
            label="Pen Away"
            value={awayPenalties}
            onChange={setAwayPenalties}
            disabled={saving}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          2H goals: {home2H === null ? "—" : home2H} —{" "}
          {away2H === null ? "—" : away2H} <span>(computed)</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="neon-button px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {result?.ok && (
            <span className="text-xs text-muted-foreground">Saved.</span>
          )}
        </div>
      </form>

      {result && !result.ok && (
        <p className="text-destructive text-sm">
          {result.error}
          {result.message ? ` — ${result.message}` : ""}
        </p>
      )}

      {result?.ok && result.data && (
        <SaveResultPanel data={result.data} />
      )}
    </article>
  );
}

function NumField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={50}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg bg-background/40 border border-border px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/50"
      />
    </label>
  );
}

function SaveResultPanel({
  data,
}: {
  data: NonNullable<SaveResult["data"]>;
}) {
  return (
    <div className="rounded-xl bg-background/40 border border-border p-3 text-sm space-y-2">
      <p className="text-xs">
        ✓ Saved. Status: <span className="font-mono">{data.match.status}</span>{" "}
        · Score:{" "}
        <span className="font-mono">
          {data.match.homeScore ?? "—"}-{data.match.awayScore ?? "—"}
        </span>
      </p>
      {data.transitionedToFinished && data.settlements.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Auto-settled:</p>
          <ul className="text-xs space-y-1">
            {data.settlements.map((s) => (
              <li key={s.marketId}>
                <span className="font-mono">{s.marketType}</span> →{" "}
                <span className="font-mono">{s.correctAnswer}</span> ·{" "}
                {s.scoredRows} bet{s.scoredRows === 1 ? "" : "s"} scored
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Warnings:</p>
          <ul className="text-xs space-y-1 text-warning">
            {data.warnings.map((w, i) => (
              <li key={i}>· {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
