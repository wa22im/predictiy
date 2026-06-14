"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { leaveGroupAction } from "@/app/(app)/groups/actions";
import { cn } from "@/lib/utils";

type Props = {
  groupId: string;
  /**
   * `true` when the current user is the only remaining member of the
   * group. The page is expected to hide the button in that case (it
   * is passed in only as a defensive fallback — the button renders a
   * warning modal if invoked directly).
   */
  isSoleMember: boolean;
};

/**
 * "Leave pool" button + confirmation modal.
 *
 * The button is a ghost/secondary action (the destructive intent is
 * de-emphasised relative to the primary "Matches" / "Leaderboard"
 * links on the page). The confirmation modal mirrors the portal +
 * scroll-lock + Escape-to-close pattern from `CreatePoolButton`.
 *
 * On successful leave the user is redirected to `/dashboard` (per
 * ISC #10). We redirect unconditionally because the service
 * `leaveGroup` hard-deletes the group when the last member leaves —
 * after that the group detail page is a 404, and a non-deleted
 * group that the user just left is no longer accessible to them.
 */
export function LeaveGroupButton({ groupId, isSoleMember }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

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

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await leaveGroupAction(groupId);
      if (result.ok) {
        // Group either still exists (other members remain) or was
        // hard-deleted (last member just left). Either way the user
        // is no longer a member, so the group detail page is no
        // longer a valid destination.
        setOpen(false);
        router.push("/dashboard");
      } else if (result.error === "NOT_AUTHENTICATED") {
        setError("You need to be signed in to leave a pool.");
      } else if (result.error === "NOT_A_MEMBER") {
        // Edge case: the user opened the modal, then someone removed
        // them (or the group was deleted). Bounce to the dashboard
        // and let the page re-render with the new state.
        setError("You are no longer a member of this pool.");
        setTimeout(() => router.push("/dashboard"), 1500);
      } else {
        setError("Failed to leave the pool. Please try again.");
      }
    });
  }

  const modalNode = open && mounted ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm"
      onClick={() => !isPending && setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-pool-heading"
    >
      <div
        className="pitch-card-hero p-6 md:p-8 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="micro-tag mb-2 text-destructive">Leave Pool</p>
        <h2
          id="leave-pool-heading"
          className="font-display text-3xl tracking-tight mb-4"
        >
          Leave this pool?
        </h2>

        <p className="text-sm text-muted-foreground mb-2">
          Are you sure you want to leave this pool? You&apos;ll lose access
          to it.
        </p>
        {isSoleMember && (
          <p className="text-sm text-muted-foreground mb-2">
            You&apos;re the last member — the pool will be deleted.
          </p>
        )}

        {error && (
          <p className="text-destructive text-sm mt-3">{error}</p>
        )}

        <div className="flex gap-2 justify-end pt-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="rounded-xl px-4 py-2 text-sm border border-border hover:bg-background/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className={cn(
              "rounded-xl px-5 py-2 text-sm font-bold border border-destructive/60 bg-destructive/15 text-destructive hover:bg-destructive/25 disabled:opacity-50",
              isPending && "pointer-events-none",
            )}
          >
            {isPending ? "Leaving…" : "Confirm Leave"}
          </button>
        </div>
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
        <LogOut aria-hidden="true" className="h-4 w-4" />
        Leave pool
      </button>

      {modalNode && createPortal(modalNode, document.body)}
    </>
  );
}
