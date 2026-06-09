"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncFootballDataCompetitionAction } from "@/app/(app)/admin/leagues/actions";

type SyncSuccessState = {
  createdMatches: number;
  updatedMatches: number;
  settledMarkets: number;
  fetched: number;
};

type SyncState =
  | { kind: "idle" }
  | { kind: "success"; data: SyncSuccessState }
  | { kind: "empty"; fetched: number }
  | { kind: "error"; message: string };

export function SyncCompetitionButton({
  competitionId,
  externalSource,
}: {
  competitionId: string;
  externalSource: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<SyncState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const enabled = externalSource === "football-data";
  const tooltip =
    externalSource === "football-data"
      ? undefined
      : "Migrate to football-data first";

  const trigger = () => {
    setState({ kind: "idle" });
    startTransition(async () => {
      const result = await syncFootballDataCompetitionAction(competitionId);
      if (result.ok) {
        if (result.fetched === 0) {
          setState({ kind: "empty", fetched: 0 });
        } else {
          setState({
            kind: "success",
            data: {
              createdMatches: result.createdMatches,
              updatedMatches: result.updatedMatches,
              settledMarkets: result.settledMarkets,
              fetched: result.fetched,
            },
          });
        }
        router.refresh();
      } else {
        setState({ kind: "error", message: result.error });
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button
        type="button"
        onClick={trigger}
        disabled={isPending || !enabled}
        title={tooltip}
        aria-disabled={!enabled}
        className="neon-button px-3 py-1 text-xs font-bold disabled:opacity-50 disabled:pointer-events-none"
      >
        {isPending ? "Syncing…" : "Sync now"}
      </button>
      {state.kind === "success" && (
        <span className="text-xs text-muted-foreground">
          {state.data.createdMatches > 0
            ? `${state.data.createdMatches} new match${state.data.createdMatches === 1 ? "" : "es"} added`
            : "No new matches"}
          {state.data.settledMarkets > 0
            ? `, ${state.data.settledMarkets} market${state.data.settledMarkets === 1 ? "" : "s"} settled`
            : ""}
        </span>
      )}
      {state.kind === "empty" && (
        <span className="text-xs text-muted-foreground">
          No new matches — the API doesn&apos;t have additional fixtures yet
        </span>
      )}
      {state.kind === "error" && (
        <span className="text-xs text-destructive">Sync failed: {state.message}</span>
      )}
    </div>
  );
}
