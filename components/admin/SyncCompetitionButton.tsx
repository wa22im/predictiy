"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncCompetitionAction } from "@/app/(app)/admin/leagues/actions";

export function SyncCompetitionButton({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trigger = () => {
    setError(null);
    startTransition(async () => {
      const result = await syncCompetitionAction(competitionId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button
        type="button"
        onClick={trigger}
        disabled={isPending}
        className="command-strip px-3 py-1 text-xs font-bold disabled:opacity-50 disabled:pointer-events-none"
      >
        {isPending ? "Syncing…" : "Sync now"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
