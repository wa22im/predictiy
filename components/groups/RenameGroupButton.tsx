"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { renameGroupAction } from "@/app/(app)/groups/actions";
import { cn } from "@/lib/utils";

type Props = {
  groupId: string;
  currentName: string;
};

/**
 * "Rename pool" button + edit modal.
 *
 * Visible to the group creator only (per ISC #8). The page is
 * responsible for the visibility decision; this component assumes
 * it has been authorised.
 *
 * The input is pre-filled with the current name and the modal
 * pre-focusses the field on open. The server action validates
 * length (1-80 chars) — we re-validate on the client for instant
 * feedback, but the server is the source of truth.
 *
 * On success the modal closes and `router.refresh()` revalidates
 * the page so the new name appears (per ISC #11). The server
 * action also revalidates `/groups/[id]` and `/groups` itself, but
 * we trigger a client refresh too as a belt-and-braces measure
 * (the user is already on the page; `refresh()` re-runs the
 * server component).
 */
export function RenameGroupButton({ groupId, currentName }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep the input in sync with the prop in case the page is
  // revalidated externally (e.g. another tab renamed the group).
  useEffect(() => {
    if (!open) setName(currentName);
  }, [currentName, open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const trimmed = name.trim();
  const isValid = trimmed.length >= 1 && trimmed.length <= 80;
  const isUnchanged = trimmed === currentName.trim();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!isValid) {
      setError("Name must be between 1 and 80 characters.");
      return;
    }
    if (isUnchanged) {
      // No-op: just close the modal.
      setOpen(false);
      return;
    }

    startTransition(async () => {
      const result = await renameGroupAction(groupId, trimmed);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else if (result.error === "NOT_AUTHENTICATED") {
        setError("You need to be signed in to rename a pool.");
      } else if (result.error === "FORBIDDEN_ONLY_CREATOR_CAN_RENAME") {
        setError("Only the pool creator can rename it.");
      } else if (result.error === "LEGACY_GROUP_NO_CREATOR") {
        setError(
          "This pool has no recorded creator and can't be renamed. Ask an admin.",
        );
      } else if (result.error === "INVALID_NAME_LENGTH") {
        setError("Name must be between 1 and 80 characters.");
      } else {
        setError("Failed to rename the pool. Please try again.");
      }
    });
  }

  const modalNode = open && mounted ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm"
      onClick={() => !isPending && setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-pool-heading"
    >
      <div
        className="pitch-card-hero p-6 md:p-8 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="micro-tag mb-2">Rename Pool</p>
        <h2
          id="rename-pool-heading"
          className="font-display text-3xl tracking-tight mb-6"
        >
          Rename this pool
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="rename-pool-name" className="micro-tag block mb-2">
              Pool name
            </label>
            <input
              id="rename-pool-name"
              name="name"
              type="text"
              required
              minLength={1}
              maxLength={80}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Friday Night Crew"
              className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
            <p
              className={cn(
                "text-xs mt-1",
                trimmed.length > 80
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {trimmed.length}/80
            </p>
          </div>

          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={isPending}
              className="rounded-xl px-4 py-2 text-sm border border-border hover:bg-background/60 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !isValid}
              className={cn(
                "neon-button px-5 py-2 text-sm font-bold",
                (isPending || !isValid) && "opacity-50 pointer-events-none",
              )}
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl px-4 py-2 text-sm font-bold border border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors inline-flex items-center gap-2"
      >
        <Pencil aria-hidden="true" className="h-4 w-4" />
        Rename pool
      </button>

      {modalNode && createPortal(modalNode, document.body)}
    </>
  );
}
