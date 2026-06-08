"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Competition } from "@/lib/services/football-data";

type AreaOption = { id: number; name: string; code: string | null };

type OnboardResult = {
  competitionId: string;
  competitionName: string;
  finishedAtIngest: number;
  createdMatches: number;
  updatedMatches: number;
  createdMarkets: number;
  updatedMarkets: number;
  totalMatches: number;
  errors: { apiMatchId?: string; message: string }[];
};

/**
 * Client-side filterable list of competitions. The page already fetched
 * the full catalogue on the server (the API key never reaches the
 * client); this component only does a local filter.
 *
 * The Onboard button hits POST /api/v1/admin/competitions/onboard,
 * which proxies to lib/services/onboard-competition.ts. We pass the
 * competition's code (e.g. "PL", "WC") and the display name. On
 * success we redirect to /admin/leagues where the new competition
 * appears in the roster.
 */
export function DiscoverCompetitionsList({
  competitions,
  areas,
}: {
  competitions: Competition[];
  areas: AreaOption[];
}) {
  const [areaId, setAreaId] = useState<string>("ALL");
  const [type, setType] = useState<string>("ALL");

  const filtered = useMemo(() => {
    return competitions.filter((c) => {
      if (areaId !== "ALL" && String(c.area.id) !== areaId) return false;
      if (type !== "ALL" && c.type !== type) return false;
      return true;
    });
  }, [competitions, areaId, type]);

  return (
    <div className="space-y-4">
      <div className="paper-card p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label
            htmlFor="area"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Country / Area
          </label>
          <select
            id="area"
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className="w-full rounded-xl bg-background/40 border border-border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <option value="ALL">All areas ({competitions.length})</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.code ? ` · ${a.code}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label
            htmlFor="type"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Type
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-xl bg-background/40 border border-border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <option value="ALL">All types</option>
            <option value="LEAGUE">League</option>
            <option value="CUP">Cup</option>
            <option value="PLAYOFF">Playoff</option>
            <option value="SUPER_CUP">Super cup</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div className="text-xs text-muted-foreground ml-auto self-center">
          Showing {filtered.length} of {competitions.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No competitions match the current filter.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <CompetitionRow key={c.id} competition={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CompetitionRow({ competition: c }: { competition: Competition }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; result: OnboardResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // A competition is only onboardable if it has a stable code (the
  // code is the lookup key for the football-data.org v4 API). Some
  // catalogue entries have `code: null` — we surface that as a
  // disabled button with a tooltip.
  const hasCode = !!c.code;
  const displayName = c.name;

  function handleOnboard() {
    if (!hasCode || !c.code) return;
    setStatus({ kind: "loading" });
    startTransition(async () => {
      try {
        const res = await fetch("/api/v1/admin/competitions/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: c.code, displayName }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          setStatus({
            kind: "error",
            message: body.error || body.message || `HTTP ${res.status}`,
          });
          return;
        }
        const result = (await res.json()) as OnboardResult;
        setStatus({ kind: "success", result });
        // Brief delay so the admin can read the result panel, then
        // bounce to the league roster where the new competition now
        // appears.
        setTimeout(() => {
          router.push("/admin/leagues");
        }, 1500);
      } catch (e) {
        setStatus({ kind: "error", message: (e as Error).message });
      }
    });
  }

  const isLoading = isPending || status.kind === "loading";
  const isSuccess = status.kind === "success";

  return (
    <li className="paper-card p-4">
      <div className="flex items-start gap-3">
        {c.emblem && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.emblem}
            alt=""
            width={32}
            height={32}
            className="w-8 h-8 shrink-0 mt-0.5"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">
                {c.name}
                {c.code && (
                  <span className="ml-2 text-xs font-mono text-muted-foreground">
                    {c.code}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.area.name}
                {c.area.code ? ` · ${c.area.code}` : ""} · {c.type}
                {c.plan ? ` · ${c.plan}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={handleOnboard}
              disabled={!hasCode || isLoading || isSuccess}
              title={
                hasCode
                  ? isSuccess
                    ? "Onboarded — redirecting to /admin/leagues"
                    : "Fetch matches from football-data.org and save to the database"
                  : "Cannot onboard: this competition has no code in the football-data.org catalogue"
              }
              className="command-strip px-3 py-1 text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isLoading
                ? "Onboarding…"
                : isSuccess
                  ? "Onboarded ✓"
                  : "Onboard"}
            </button>
          </div>
          {c.currentSeason && (
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              Current season: {c.currentSeason.startDate} → {c.currentSeason.endDate}
              {c.currentSeason.currentMatchday != null &&
                ` · matchday ${c.currentSeason.currentMatchday}`}
            </p>
          )}

          {status.kind === "success" && (
            <div className="mt-3 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs">
              <p className="font-medium text-emerald-600 dark:text-emerald-400">
                Onboarded: {status.result.createdMatches} new +{" "}
                {status.result.updatedMatches} updated matches,{" "}
                {status.result.createdMarkets + status.result.updatedMarkets}{" "}
                markets.
                {status.result.finishedAtIngest > 0 && (
                  <>
                    {" "}
                    {status.result.finishedAtIngest} match
                    {status.result.finishedAtIngest === 1 ? "" : "es"} already
                    finished — settle them via the Settlement Hub.
                  </>
                )}
              </p>
              <p className="text-muted-foreground mt-1">
                Redirecting to league roster…
              </p>
            </div>
          )}

          {status.kind === "error" && (
            <div className="mt-3 p-2 rounded-md bg-destructive/10 border border-destructive/30 text-xs">
              <p className="font-medium text-destructive">
                Onboard failed: {status.message}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
