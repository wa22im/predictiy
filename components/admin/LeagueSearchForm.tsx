"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ingestLeagueAction } from "@/app/(app)/admin/leagues/actions";
import type { LeagueSearchResult } from "@/lib/services/api-football";

/**
 * League picker. Type a query (e.g., "Premier", "Liga", "Champions"),
 * we hit the search server action, get a list of leagues with their
 * available seasons, and let the admin pick one to ingest.
 */
export function LeagueSearchForm({
  takenKeys,
}: {
  takenKeys: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeagueSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [isIngesting, startIngest] = useTransition();
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestWarning, setIngestWarning] = useState<string | null>(null);

  const search = () => {
    if (!query.trim()) return;
    setSearchError(null);
    startSearch(async () => {
      try {
        const res = await fetch("/api/v1/admin/leagues/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSearchError(body.error ?? `Search failed: ${res.status}`);
          return;
        }
        const data = (await res.json()) as { results: LeagueSearchResult[] };
        setResults(data.results);
      } catch (e) {
        setSearchError((e as Error).message);
      }
    });
  };

  const ingest = (leagueId: number, season: number, displayName: string) => {
    setIngestError(null);
    setIngestWarning(null);
    const name = `${displayName} ${season}`;
    startIngest(async () => {
      const result = await ingestLeagueAction({
        name,
        externalLeagueId: leagueId,
        externalSeason: season,
      });
      if (result.ok) {
        if (result.warning) {
          // 0 fixtures — show the warning but don't navigate yet
          setIngestWarning(result.warning);
          return;
        }
        router.push("/admin/leagues");
        router.refresh();
      } else {
        setIngestError(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="q">
          Search leagues
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
            placeholder="e.g. Premier, Liga, Champions"
            className="flex-1 rounded-xl bg-background/40 border border-border p-2 focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          <button
            type="button"
            onClick={search}
            disabled={isSearching || !query.trim()}
            className="command-strip px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSearching ? "Searching…" : "Search"}
          </button>
        </div>
        {searchError && <p className="text-destructive text-xs">{searchError}</p>}
      </div>

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((r) => (
            <LeagueRow
              key={`${r.league.id}-${r.seasons.map((s) => s.year).join(",")}`}
              league={r.league}
              seasons={r.seasons}
              takenKeys={takenKeys}
              onIngest={ingest}
              isIngesting={isIngesting}
            />
          ))}
        </ul>
      )}

      {ingestError && <p className="text-destructive text-xs">{ingestError}</p>}

      {ingestWarning && (
        <div className="paper-card p-4 border-amber-500/40 space-y-3">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {ingestWarning}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setIngestWarning(null);
                router.push("/admin/leagues");
              }}
              className="text-xs font-medium underline-offset-2 hover:underline"
            >
              Go to league list anyway
            </button>
          </div>
        </div>
      )}

      {!isSearching && results.length === 0 && query && (
        <p className="text-xs text-muted-foreground">No results. Try a different query.</p>
      )}
    </div>
  );
}

function LeagueRow({
  league,
  seasons,
  takenKeys,
  onIngest,
  isIngesting,
}: {
  league: LeagueSearchResult["league"];
  seasons: LeagueSearchResult["seasons"];
  takenKeys: string[];
  onIngest: (leagueId: number, season: number, displayName: string) => void;
  isIngesting: boolean;
}) {
  const displayName = [league.country?.name, league.name].filter(Boolean).join(" · ");
  return (
    <li className="paper-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground font-mono">
            id={league.id} · {league.type}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        {seasons
          // Policy: only ingest the current season. Past seasons are
          // hidden entirely so an admin can't accidentally (or
          // deliberately) waste API budget on old data.
          .filter((s) => s.current)
          .map((s) => {
            const key = `${league.id}:${s.year}`;
            const taken = takenKeys.includes(key);
            return (
              <button
                key={s.year}
                type="button"
                disabled={taken || isIngesting}
                onClick={() => onIngest(league.id, s.year, displayName)}
                className={`text-xs font-mono rounded-full px-3 py-1 border transition-colors ${
                  taken
                    ? "border-border text-muted-foreground cursor-not-allowed"
                    : "border-primary/40 hover:border-primary text-foreground"
                }`}
              >
                {s.year}
                {taken ? " · onboarded" : " · current"}
              </button>
            );
          })}
        {seasons.filter((s) => !s.current).length > 0 && (
          <span className="text-xs text-muted-foreground">
            {seasons.filter((s) => !s.current).length} past season
            {seasons.filter((s) => !s.current).length === 1 ? "" : "s"} hidden
          </span>
        )}
      </div>
    </li>
  );
}
