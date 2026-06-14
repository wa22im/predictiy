"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  addMatchesToCompetitionAction,
  removeMatchFromCompetitionAction,
} from "@/app/(app)/admin/leagues/actions";
import { cn } from "@/lib/utils";
import { formatUtc } from "@/lib/time";
import { CrestSlot } from "@/components/football";
import { MIN_MS_BEFORE_KICKOFF } from "@/lib/validation/tournament";

type MatchStatus = "SCHEDULED" | "GOING" | "FINISHED";

type ManagerMatch = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  status: MatchStatus;
  homeCrest: string | null;
  awayCrest: string | null;
};

type SourceCompetition = {
  id: string;
  name: string;
  externalSource: string | null;
};

type SourceMatch = ManagerMatch & { competitionId: string };

/**
 * Admin UI: manage the matches in a custom (manual) tournament.
 *
 * Responsibilities:
 *   1. Render the list of matches currently linked to the tournament
 *      (server-supplied via `initialMatches`) with a per-row "Remove"
 *      button. The button is disabled for matches that have started
 *      or finished — the DELETE endpoint enforces the same gate
 *      server-side, and the UI mirrors the rule so the admin never
 *      sees a 400 bounce for a match they can't actually remove.
 *   2. Render an "Add matches" button that opens a modal with a
 *      competition picker (step 1) and a multi-select match list
 *      (step 2). The match list is filterable by "kickoffTime > now"
 *      so the admin can hide already-played matches they don't
 *      intend to include.
 *
 * Implementation notes:
 *   - The modal uses a React portal into <body>, mirroring
 *     `components/groups/CreatePoolButton.tsx`. The portal avoids
 *     ancestor `overflow: hidden` / stacking-context interactions
 *     that would clip the dialog (the rationale is documented in
 *     full in that file).
 *   - We keep all source matches in memory rather than refetching
 *     on competition selection. The principal's user base is small
 *     (max 10 tournaments) so the payload is bounded; the win is
 *     a snappy step-1 → step-2 transition.
 */
export function CustomTournamentMatchManager({
  competitionId,
  competitionEndDate,
  initialMatches,
  sourceCompetitions,
  sourceMatches,
}: {
  competitionId: string;
  /**
   * ISO string of the tournament's end date (or null for vendor
   * tournaments / legacy custom tournaments with no endDate). The
   * "Add matches" filter uses this to hide matches scheduled past
   * the end date (mirrors the server's MATCH_AFTER_ENDDATE gate).
   * Pre-2026-10 the picker only filtered on "future"; the new
   * behaviour is more strict — the same constraint the server
   * enforces.
   */
  competitionEndDate: string | null;
  initialMatches: ManagerMatch[];
  sourceCompetitions: SourceCompetition[];
  sourceMatches: SourceMatch[];
}) {
  const router = useRouter();
  const [matches, setMatches] = useState<ManagerMatch[]>(initialMatches);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [, startRemoveTransition] = useTransition();

  // Keep local state in sync if the server passes down new data
  // (e.g. after router.refresh() from a sibling action). The dep
  // array is the initial-matches identity; we only reset when the
  // server-side list itself changes.
  useEffect(() => {
    setMatches(initialMatches);
  }, [initialMatches]);

  // Matches the admin can already SEE are in the tournament. We
  // hide those in the modal's step-2 list so the admin doesn't try
  // to re-add them (the server is idempotent via skipDuplicates, but
  // it's noise on screen).
  const alreadyLinkedIds = useMemo(
    () => new Set(matches.map((m) => m.id)),
    [matches],
  );

  function canRemove(m: ManagerMatch, now: number): boolean {
    if (m.status === "FINISHED") return false;
    if (new Date(m.kickoffTime).getTime() <= now) return false;
    return true;
  }

  function handleRemove(matchId: string) {
    setRemoveError(null);
    setRemovingId(matchId);
    startRemoveTransition(async () => {
      const result = await removeMatchFromCompetitionAction(
        competitionId,
        matchId,
      );
      setRemovingId(null);
      if (result.ok) {
        setMatches((prev) => prev.filter((m) => m.id !== matchId));
        router.refresh();
      } else {
        setRemoveError(result.error);
      }
    });
  }

  const now = Date.now();

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl font-bold tracking-tight">
          Matches in this tournament
        </h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="neon-button px-4 py-2 text-sm font-bold"
          data-testid="add-matches-button"
        >
          + Add matches
        </button>
      </div>

      {removeError && (
        <p className="text-destructive text-sm mb-3">
          Remove failed: {removeError}
        </p>
      )}

      {matches.length === 0 ? (
        <div className="pitch-card-hero p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No matches yet. Click &quot;Add matches&quot; to add some.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="match-list">
          {matches.map((m) => {
            const locked = !canRemove(m, now);
            return (
              <li
                key={m.id}
                className="pitch-card p-4 flex items-center gap-3"
                data-testid="match-row"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <CrestSlot
                    src={m.homeCrest}
                    name={m.homeTeam}
                    size="sm"
                  />
                  <span className="truncate font-medium text-sm">
                    {m.homeTeam} vs {m.awayTeam}
                  </span>
                  <CrestSlot
                    src={m.awayCrest}
                    name={m.awayTeam}
                    size="sm"
                  />
                </div>
                <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground font-mono shrink-0">
                  <span>{formatUtc(m.kickoffTime)}</span>
                  <StatusBadge status={m.status} />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(m.id)}
                  disabled={locked || removingId === m.id}
                  title={
                    locked
                      ? "Cannot remove a match that has already started"
                      : "Remove this match from the tournament"
                  }
                  className={cn(
                    "shrink-0 px-3 py-1 text-xs font-bold border border-destructive/50 text-destructive rounded hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                  )}
                >
                  {removingId === m.id ? "Removing…" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {modalOpen && (
        <AddMatchesModal
          competitionId={competitionId}
          endDate={competitionEndDate}
          sourceCompetitions={sourceCompetitions}
          sourceMatches={sourceMatches}
          alreadyLinkedIds={alreadyLinkedIds}
          onClose={() => setModalOpen(false)}
          onAdded={(added) => {
            // The action returns the count of rows actually inserted
            // (idempotent on duplicates — see the route's
            // skipDuplicates). We don't get the rows themselves back,
            // so the canonical list comes from a server refresh.
            // router.refresh() re-renders the server component, which
            // re-reads the matches and pushes them down as a new
            // `initialMatches` prop. The useEffect above then resets
            // local state to match.
            if (added > 0) {
              router.refresh();
            }
            setModalOpen(false);
          }}
        />
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  if (status === "FINISHED") {
    return <span className="micro-tag text-muted-foreground mt-1">Settled</span>;
  }
  if (status === "GOING") {
    return <span className="micro-tag text-success mt-1">Live</span>;
  }
  return <span className="micro-tag text-muted-foreground mt-1">Scheduled</span>;
}

/**
 * Modal: two-step picker for adding matches to the tournament.
 *
 *   Step 1: pick a source competition (a `<select>`).
 *   Step 2: pick one or more matches from that competition
 *            (checkboxes, with a "show only future matches" filter
 *            so the admin can prune already-played entries).
 *
 * The action call goes through `addMatchesToCompetitionAction` which
 * delegates to the existing API route. Errors surface inline; on
 * success we call `onAdded` so the parent can refresh and close.
 */
function AddMatchesModal({
  competitionId,
  endDate,
  sourceCompetitions,
  sourceMatches,
  alreadyLinkedIds,
  onClose,
  onAdded,
}: {
  competitionId: string;
  /**
   * ISO string of the tournament's end date (or null). Used by
   * the step-2 filter to hide matches past the end date — the
   * server's MATCH_AFTER_ENDDATE gate is mirrored here so the
   * user can't pick a match that would be rejected.
   */
  endDate: string | null;
  sourceCompetitions: SourceCompetition[];
  sourceMatches: SourceMatch[];
  alreadyLinkedIds: Set<string>;
  onClose: () => void;
  onAdded: (added: number) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [pickedCompetitionId, setPickedCompetitionId] = useState<string>("");
  const [pickedMatchIds, setPickedMatchIds] = useState<Set<string>>(new Set());
  const [onlyFuture, setOnlyFuture] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  // SSR guard: `document` is undefined during server render. The
  // portal target only exists on the client.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape (unless a request is in flight — we don't want
  // to lose the user's picks to a stray keypress mid-submit).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isPending]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const now = Date.now();

  // Matches in the picked source competition. Pre-fetched by the
  // server; we filter here on the client.
  const matchesInPicked = useMemo(
    () =>
      pickedCompetitionId
        ? sourceMatches.filter((m) => m.competitionId === pickedCompetitionId)
        : [],
    [sourceMatches, pickedCompetitionId],
  );

  // "Future" matches per the ISC: kickoffTime > now +
  // MIN_HOURS_BEFORE_KICKOFF. The server enforces the same buffer
  // (returns 400 `MATCH_TOO_CLOSE`); the UI mirrors it so the user
  // doesn't pick a match the server will reject. We also filter
  // out matches past the tournament's end date (the server's
  // `MATCH_AFTER_ENDDATE` gate). We keep all other matches in the
  // underlying list — the admin can untick the filter to see them.
  const endDateMs = endDate ? new Date(endDate).getTime() : null;
  const filteredMatches = useMemo(() => {
    if (!onlyFuture) return matchesInPicked;
    const cutoff = now + MIN_MS_BEFORE_KICKOFF;
    return matchesInPicked.filter((m) => {
      const kickoff = new Date(m.kickoffTime).getTime();
      if (kickoff <= cutoff) return false;
      if (endDateMs !== null && kickoff > endDateMs) return false;
      return true;
    });
  }, [matchesInPicked, onlyFuture, now, endDateMs]);

  // De-dup against matches the admin already linked. We never
  // uncheck a server-confirmed link from the modal.
  const selectableMatches = filteredMatches.filter(
    (m) => !alreadyLinkedIds.has(m.id),
  );

  // Counts for the "Select all" header. We use the visible
  // `selectableMatches` (after the already-linked filter) as the
  // universe — that way "Select all" means "select all of the rows
  // the user can actually see and toggle".
  const visibleIds = useMemo(
    () => new Set(selectableMatches.map((m) => m.id)),
    [selectableMatches],
  );
  const visibleSelectedCount = useMemo(
    () =>
      [...pickedMatchIds].reduce(
        (n, id) => (visibleIds.has(id) ? n + 1 : n),
        0,
      ),
    [pickedMatchIds, visibleIds],
  );
  const allVisibleSelected =
    selectableMatches.length > 0 &&
    visibleSelectedCount === selectableMatches.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < selectableMatches.length;

  // "Select all" header checkbox — the ref lets us toggle the
  // indeterminate DOM attribute (not a React-controlled prop) when
  // the user has picked a partial subset. React only listens to
  // `checked`, so the ref is the only way to express 3-state.
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  function toggleMatch(id: string) {
    setPickedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAllToggle() {
    setPickedMatchIds((prev) => {
      if (allVisibleSelected) {
        // All visible rows are picked → drop just the visible ones,
        // preserve any picks the user made on a different filter
        // pass that aren't in the current visible set.
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      // Some or none selected → select all visible rows, preserving
      // any other picks.
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  function handleAdd() {
    setError(null);
    if (pickedMatchIds.size === 0) {
      setError("Pick at least one match");
      return;
    }
    startTransition(async () => {
      const result = await addMatchesToCompetitionAction(
        competitionId,
        Array.from(pickedMatchIds),
      );
      if (result.ok) {
        onAdded(result.added);
      } else {
        setError(result.error);
      }
    });
  }

  // The modal markup. Rendered into a portal at the bottom of the
  // return so the toggle/visibility logic stays readable.
  const modalNode = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm"
      onClick={() => !isPending && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-matches-heading"
    >
      <div
        className="pitch-card-hero p-6 md:p-8 max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="micro-tag mb-2">Add Matches</p>
        <h2
          id="add-matches-heading"
          className="font-display text-2xl tracking-tight mb-4"
        >
          {step === 1 ? "Pick a source competition" : "Pick matches"}
        </h2>

        {step === 1 && (
          <div className="space-y-4 flex-1 overflow-y-auto">
            <div>
              <label htmlFor="sourceCompetition" className="micro-tag block mb-2">
                Source competition
              </label>
              <select
                id="sourceCompetition"
                value={pickedCompetitionId}
                onChange={(e) => setPickedCompetitionId(e.target.value)}
                className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
                disabled={isPending}
              >
                <option value="">Select a competition…</option>
                {sourceCompetitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.externalSource ? ` (${c.externalSource})` : ""}
                  </option>
                ))}
              </select>
              {sourceCompetitions.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No other competitions available. Onboard a vendor
                  competition or create another custom one first.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded-xl px-4 py-2 text-sm border border-border hover:bg-background/60 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!pickedCompetitionId}
                className="neon-button px-5 py-2 text-sm font-bold disabled:opacity-40 disabled:pointer-events-none"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setPickedMatchIds(new Set());
                }}
                disabled={isPending}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                ← Back to competition picker
              </button>
              <label className="text-xs flex items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyFuture}
                  onChange={(e) => setOnlyFuture(e.target.checked)}
                  className="rounded"
                  data-testid="only-future-checkbox"
                />
                Show only future matches
              </label>
            </div>

            <div className="flex-1 overflow-y-auto border border-border/60 rounded-xl p-2 space-y-1 min-h-0">
              {selectableMatches.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">
                  {onlyFuture
                    ? "No future matches in this competition. Untick the filter to see all matches."
                    : "No matches available in this competition."}
                </p>
              ) : (
                <>
                  <label
                    className={cn(
                      "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-background/40 border-b border-border/60 mb-1",
                    )}
                    data-testid="select-all-row"
                  >
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={handleSelectAllToggle}
                      className="rounded shrink-0"
                      data-testid="select-all-checkbox"
                    />
                    <span className="text-sm font-medium">
                      Select all ({selectableMatches.length})
                    </span>
                  </label>
                  {selectableMatches.map((m) => {
                  const checked = pickedMatchIds.has(m.id);
                  return (
                    <label
                      key={m.id}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-background/40",
                        checked && "bg-primary/10",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMatch(m.id)}
                        className="rounded shrink-0"
                      />
                      <CrestSlot
                        src={m.homeCrest}
                        name={m.homeTeam}
                        size="sm"
                      />
                      <span className="text-sm flex-1 truncate">
                        {m.homeTeam} vs {m.awayTeam}
                      </span>
                      <CrestSlot
                        src={m.awayCrest}
                        name={m.awayTeam}
                        size="sm"
                      />
                      <span className="text-xs font-mono text-muted-foreground shrink-0">
                        {formatUtc(m.kickoffTime)}
                      </span>
                      <StatusBadge status={m.status} />
                    </label>
                  );
                })}
                </>
              )}
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <div className="flex items-center justify-between gap-2 pt-2">
              <p className="text-xs text-muted-foreground">
                {pickedMatchIds.size} match
                {pickedMatchIds.size === 1 ? "" : "es"} selected
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="rounded-xl px-4 py-2 text-sm border border-border hover:bg-background/60 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={isPending || pickedMatchIds.size === 0}
                  className={cn(
                    "neon-button px-5 py-2 text-sm font-bold",
                    (isPending || pickedMatchIds.size === 0) &&
                      "opacity-50 pointer-events-none",
                  )}
                >
                  {isPending ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalNode, document.body);
}
