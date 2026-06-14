"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createCustomCompetitionAction } from "@/app/(app)/admin/leagues/actions";
import { cn } from "@/lib/utils";

/**
 * Admin UI: a button that opens a modal for creating a new custom
 * (hand-built) tournament. The new competition is born with
 * `externalSource = null` so the cron never auto-syncs it. The admin
 * then adds matches via the "Manage matches" link in the manual
 * section of `/admin/leagues`.
 *
 * Why this is its own component (instead of inline in
 * `app/(app)/admin/leagues/page.tsx`):
 *   - The page is a server component. The modal needs `useState`,
 *     `useTransition`, and a React portal into <body> — all client
 *     concerns. Keeping them in a dedicated `"use client"` file
 *     preserves the server-render boundary cleanly.
 *   - Mirrors the pattern of `CreatePoolButton.tsx` and
 *     `CustomTournamentMatchManager.tsx` (one component per modal,
 *     no shared "Modal" abstraction — the project intentionally
 *     keeps modals self-contained).
 *
 * UX details:
 *   - `name` input is 1–120 chars (matches the Zod schema).
 *   - `endDate` is REQUIRED — the DB enforces a CHECK constraint
 *     (`endDate_required_for_custom` in `prisma/init.sql`) and the
 *     API returns 400 `ENDDATE_REQUIRED` if missing. The native
 *     `datetime-local` input maps to the form's local timezone, then
 *     we convert to UTC ISO 8601 before sending (the server stores
 *     it as a `Date` and the API schema validates `z.string().datetime()`).
 *   - The endDate is set ONCE at creation and is IMMUTABLE afterward
 *     (per the Phase X rule documented in `app/api/v1/admin/competitions/
 *     [id]/route.ts` PATCH immutability + `components/admin/
 *     EditCompetitionButton.tsx`). The modal copy says so explicitly.
 *   - The submit button is disabled via `useTransition`'s `isPending`.
 *   - Escape, backdrop click, and the X button all close the modal —
 *     but only when no request is in flight (no point abandoning a
 *     submit mid-flight via a stray keypress).
 */
export function CreateCustomTournamentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // SSR guard: `document` is undefined during server render. The
  // portal target (`document.body`) only exists on the client. We
  // mount lazily via useEffect to avoid referencing `document` at
  // render time. Mirrors `CreatePoolButton.tsx`.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape. Re-binds when `open` flips so listeners don't
  // accumulate across open/close cycles. Disabled while a request is
  // in flight (avoid losing a submit to a stray keypress). Mirrors
  // the pattern in `CreatePoolButton.tsx`.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) {
        setOpen(false);
        setName("");
        setEndDate("");
        setError(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending]);

  // Lock body scroll while the modal is open. Restores on close.
  // Mirrors `CreatePoolButton.tsx`.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function close() {
    if (isPending) return;
    setOpen(false);
    setName("");
    setEndDate("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 1) {
      setError("Name is required");
      return;
    }
    if (trimmedName.length > 120) {
      setError("Name must be 120 characters or fewer");
      return;
    }
    if (!endDate) {
      setError("End date is required");
      return;
    }

    // `datetime-local` returns a value like "2026-12-31T23:59" in the
    // browser's local timezone. `new Date(...)` parses it as local
    // time; `.toISOString()` normalizes to UTC, which is what the
    // server's `z.string().datetime()` schema expects.
    const endDateIso = new Date(endDate).toISOString();

    startTransition(async () => {
      const result = await createCustomCompetitionAction({
        name: trimmedName,
        endDate: endDateIso,
      });
      if (result.ok) {
        // The action already calls revalidatePath('/admin/leagues')
        // server-side on success, but `router.refresh()` is also
        // safe to call — it re-fetches the server tree. Belt and
        // braces: the new tournament will be visible in the manual
        // section immediately on close.
        router.refresh();
        close();
      } else {
        setError(result.error || "Failed to create tournament");
      }
    });
  }

  // The modal markup. Rendered into a portal at the bottom of the
  // return so the visibility/toggle logic stays readable. Mirrors
  // the rationale in `CreatePoolButton.tsx` (the hover-transform
  // ancestor clipping bug).
  const modalNode = open && mounted ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm"
      onClick={() => !isPending && close()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-custom-tournament-heading"
    >
      <div
        className="pitch-card-hero p-6 md:p-8 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="micro-tag mb-2">Custom Tournament</p>
            <h2
              id="create-custom-tournament-heading"
              className="font-display text-2xl tracking-tight"
            >
              Create custom tournament
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isPending}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          A custom tournament aggregates matches from any vendor
          competitions. It requires a name and an end date. The end
          date is set here and cannot be changed after creation.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="custom-tournament-name" className="micro-tag block mb-2">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              id="custom-tournament-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              minLength={1}
              disabled={isPending}
              required
              autoFocus
              placeholder="e.g., Best of 2026"
              className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="custom-tournament-enddate" className="micro-tag block mb-2">
              End date <span className="text-destructive">*</span>
            </label>
            <input
              id="custom-tournament-enddate"
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isPending}
              required
              className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Cannot be changed after creation.
            </p>
          </div>

          {error && (
            <p
              className="text-sm text-destructive"
              data-testid="create-custom-tournament-error"
            >
              {error}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={close}
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
              {isPending ? "Creating…" : "Create tournament"}
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
        data-testid="create-custom-tournament-button"
        className="neon-button inline-flex items-center gap-2 px-4 py-2 text-sm font-bold"
      >
        <Plus className="w-4 h-4" />
        Create custom tournament
      </button>

      {modalNode && createPortal(modalNode, document.body)}
    </>
  );
}
