"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  createGroupAction,
  createPoolWithCustomTournamentAction,
} from "@/app/(app)/dashboard/actions";
import { cn } from "@/lib/utils";

type Competition = { id: string; name: string };

/**
 * The two modes the user can pick from in the Create Pool modal.
 *
 *   - "existing": bind the new pool to a competition the user
 *     picks from the dropdown. Calls the legacy createGroupAction
 *     (the action is the same shape the dashboard used before
 *     the public-create-pool round; we keep the path live for
 *     compatibility with all existing callers and tests).
 *   - "new": create a custom tournament inline (with a name +
 *     end date) and bind the new pool to it. Calls the new
 *     `createPoolWithCustomTournamentAction` server action, which
 *     forwards to `POST /api/v1/pools`.
 *
 * The default is "existing" so the modal looks the same as it
 * did before the round — the new option is opt-in, which is
 * friendlier for users who don't know what a "custom tournament"
 * is yet.
 */
type TournamentSource = "existing" | "new";

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
  // Tournament source — toggled by the radio buttons. Default
  // "existing" preserves the pre-custom-tournament UX.
  const [source, setSource] = useState<TournamentSource>("existing");
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

    if (source === "existing") {
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
    } else {
      // "new" — create a custom tournament inline + bind the pool.
      const newTournamentName = fd.get("newTournamentName") as string;
      const newTournamentEndDate = fd.get("newTournamentEndDate") as string;
      // The datetime-local input gives us a local string like
      // "2026-12-31T23:59" — convert to ISO 8601 UTC. The
      // new Date() constructor parses this in the user's local
      // timezone; .toISOString() normalises to UTC. The Zod
      // schema on the route requires `.datetime()` (ISO 8601
      // with timezone), so we must produce a string the
      // validator accepts.
      const endDateIso = new Date(newTournamentEndDate).toISOString();
      startTransition(async () => {
        const result = await createPoolWithCustomTournamentAction({
          name,
          newCompetition: {
            name: newTournamentName,
            endDate: endDateIso,
          },
        });
        if (result.ok) {
          setOpen(false);
          // Refresh the dashboard so the new group + competition
          // appear in the listing. (router.push is enough for the
          // group page itself, but the dashboard reads the user's
          // groups at request time, so a refresh is needed to
          // surface the new pool there.)
          router.push(`/groups/${result.id}`);
        } else {
          setError(result.error ?? "Failed to create pool");
        }
      });
    }
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

          {/* TOURNAMENT SOURCE TOGGLE — radio buttons. The default
              is "existing" to preserve the pre-custom-tournament
              UX. The "new" mode reveals two extra fields below. */}
          <fieldset className="space-y-2">
            <legend className="micro-tag block mb-2">Tournament</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tournamentSource"
                value="existing"
                checked={source === "existing"}
                onChange={() => setSource("existing")}
                className="rounded"
              />
              <span className="text-sm">Use existing tournament</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tournamentSource"
                value="new"
                checked={source === "new"}
                onChange={() => setSource("new")}
                className="rounded"
              />
              <span className="text-sm">Create new custom tournament</span>
            </label>
          </fieldset>

          {source === "existing" ? (
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
                  No tournaments yet — pick &quot;Create new custom
                  tournament&quot; to add one.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="newTournamentName"
                  className="micro-tag block mb-2"
                >
                  New tournament name
                </label>
                <input
                  id="newTournamentName"
                  name="newTournamentName"
                  type="text"
                  required
                  minLength={1}
                  maxLength={120}
                  placeholder="My Friday Cup 2026"
                  className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>
              <div>
                <label
                  htmlFor="newTournamentEndDate"
                  className="micro-tag block mb-2"
                >
                  End date
                </label>
                <input
                  id="newTournamentEndDate"
                  name="newTournamentEndDate"
                  type="datetime-local"
                  required
                  className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The tournament&apos;s end date is fixed at creation.
                </p>
              </div>
            </div>
          )}

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
          className="pitch-card-fut p-3 hover:-translate-y-0.5 transition-transform text-left w-full"
        >
          <p className="font-display text-base font-bold tracking-tight">
            ➕  Create a Pool
          </p>
        </button>
      )}

      {modalNode && createPortal(modalNode, document.body)}
    </>
  );
}
