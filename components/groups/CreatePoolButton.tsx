"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createGroupAction } from "@/app/(app)/dashboard/actions";
import { cn } from "@/lib/utils";

type Competition = { id: string; name: string };

export function CreatePoolButton({
  competitions,
  variant = "button",
}: {
  competitions?: Competition[];
  variant?: "button" | "card";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // SSR guard: `document` is undefined during server render. The portal
  // target (`document.body`) only exists on the client. We mount lazily
  // via useEffect to avoid referencing `document` at render time.
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape. The effect re-binds whenever `open` flips so we
  // don't accumulate listeners across open/close cycles.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending]);

  // Lock body scroll while the modal is open. Restores on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    const competitionId = fd.get("competitionId") as string;

    startTransition(async () => {
      const result = await createGroupAction({ name, competitionId });
      if (result.ok) {
        setOpen(false);
        router.push(`/groups/${result.groupId}`);
      } else {
        setError(result.error ?? "Failed to create pool");
      }
    });
  }

  // IMPORTANT — render the modal via a React portal into <body>.
  //
  // Why: the button trigger has a hover transform (`.pitch-card-fut:hover
  // { transform: translateY(-2px) }` for the card variant, `.neon-button
  // :hover { transform: translateY(-2px) }` for the button variant). When
  // the modal opens while the user is still hovering the button, the
  // modal's containing block for `position: fixed` would be the viewport
  // (correct). BUT the button is also nested inside a parent that may
  // establish a stacking context, and the modal's `position: fixed`
  // could be visually clipped by ancestor `overflow: hidden` rules on
  // the `pitch-card-fut` wrapper.
  //
  // Concretely: when the modal was rendered in-place (a sibling of the
  // button inside the same grid), the user saw the form fields
  // "inside" the button card and the screen flickered on every
  // mouse-move because the modal's stacking/clipping interacted with
  // the button's hover transform. Portalling the modal into <body>
  // removes ALL ancestor interference — the modal is always a direct
  // child of <body>, and `position: fixed; inset: 0;` is reliably
  // viewport-relative.
  const modalNode = open && mounted ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm"
      onClick={() => !isPending && setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-pool-heading"
    >
      <div
        className="pitch-card-hero p-6 md:p-8 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="micro-tag mb-2">New Pool</p>
        <h2
          id="create-pool-heading"
          className="font-display text-3xl tracking-tight mb-6"
        >
          New Group
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="micro-tag block mb-2">
              Pool name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              minLength={1}
              maxLength={80}
              autoFocus
              placeholder="The Friday Night Crew"
              className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>

          <div>
            <label htmlFor="competitionId" className="micro-tag block mb-2">
              Tournament
            </label>
            <select
              id="competitionId"
              name="competitionId"
              required
              className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
            >
              <option value="">Select a tournament…</option>
              {competitions?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {(!competitions || competitions.length === 0) && (
              <p className="text-xs text-muted-foreground mt-1">
                No tournaments yet — ask an admin to sync one.
              </p>
            )}
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
              disabled={isPending}
              className={cn(
                "neon-button px-5 py-2 text-sm font-bold",
                isPending && "opacity-50 pointer-events-none",
              )}
            >
              {isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  return (
    <>
      {variant === "button" ? (
        <button
          onClick={() => setOpen(true)}
          className="neon-button inline-flex items-center justify-center px-6 py-3 text-base font-bold"
        >
          ➕ Create a Tournament Pool
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="pitch-card-fut p-6 hover:-translate-y-0.5 transition-transform text-left"
        >
          <p className="font-display text-2xl font-bold tracking-tight mb-2">
            ➕  New Pool
          </p>
          <p className="text-muted-foreground text-sm">
            Start a new tournament pool.
          </p>
        </button>
      )}

      {modalNode && createPortal(modalNode, document.body)}
    </>
  );
}
