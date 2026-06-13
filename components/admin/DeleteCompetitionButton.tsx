"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCompetitionAction } from "@/app/(app)/admin/leagues/actions";

type DeleteState =
  | { kind: "idle" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function DeleteCompetitionButton({
  competitionId,
  competitionName,
}: {
  competitionId: string;
  competitionName: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<DeleteState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const trigger = () => {
    const ok = window.confirm(
      `Delete "${competitionName}"?\n\n` +
        `This is a soft delete — the data is preserved and can be ` +
        `restored from the DB by clearing the deletedAt column. ` +
        `The tournament will disappear from listings immediately.`,
    );
    if (!ok) return;
    setState({ kind: "idle" });
    startTransition(async () => {
      const result = await deleteCompetitionAction(competitionId);
      if (result.ok) {
        setState({ kind: "success" });
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
        disabled={isPending}
        className="px-3 py-1 text-xs font-bold border border-destructive/40 text-destructive hover:bg-destructive/10 rounded disabled:opacity-50 disabled:pointer-events-none"
      >
        {isPending ? "Deleting…" : "Delete"}
      </button>
      {state.kind === "error" && (
        <span className="text-xs text-destructive">Delete failed: {state.message}</span>
      )}
    </div>
  );
}
