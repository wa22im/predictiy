"use client";

import { useMemo, useState } from "react";
import type { Competition } from "@/lib/services/football-data";

type AreaOption = { id: number; name: string; code: string | null };

/**
 * Client-side filterable list of competitions. The page already fetched
 * the full catalogue on the server (the API key never reaches the
 * client); this component only does a local filter.
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
              disabled
              title="Coming soon — the full onboarding flow lands in a future step"
              className="command-strip px-3 py-1 text-xs font-bold opacity-50 cursor-not-allowed shrink-0"
            >
              Onboard
            </button>
          </div>
          {c.currentSeason && (
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              Current season: {c.currentSeason.startDate} → {c.currentSeason.endDate}
              {c.currentSeason.currentMatchday != null &&
                ` · matchday ${c.currentSeason.currentMatchday}`}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
