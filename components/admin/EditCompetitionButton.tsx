"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { patchCompetitionAction } from "@/app/(app)/admin/leagues/actions";
import { DEFAULT_SCORING_CONFIG } from "@/lib/scoring/default-config";

type EditState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

type EditableCompetition = {
  id: string;
  name: string;
  endDate: string | null;
  externalLeagueId: string | null;
  externalSeason: number | null;
  details: Record<string, unknown> | null;
  // Vendor tag — null means the tournament was created by an admin
  // (custom / hydration / manual) and is NOT auto-synced by the cron.
  // Custom tournaments have an immutable endDate set at creation; see
  // `app/api/v1/admin/competitions/[id]/route.ts` PATCH. Optional for
  // backward compat with callers that haven't been updated yet — the
  // safe default is `null` (treat as custom / immutable endDate).
  externalSource?: string | null;
};

const STAGES = [
  "GROUP_STAGE",
  "ROUND_OF_16",
  "QUARTER_FINAL",
  "SEMI_FINAL",
  "FINAL",
  "THIRD_PLACE",
  "OUTRIGHT",
] as const;
type Stage = (typeof STAGES)[number];

const FIELDS = [
  "exactScorePoints",
  "drawExactScorePoints",
  "drawWrongScorePoints",
  "rightWinnerRightDiffPoints",
  "rightWinnerOnlyPoints",
  "missPoints",
] as const;
type Field = (typeof FIELDS)[number];

type ScoringOverrides = Partial<Record<Stage, Partial<Record<Field, number>>>>;

export function EditCompetitionButton({
  competition,
}: {
  competition: EditableCompetition;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EditState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  // Custom tournaments (externalSource = null) have an immutable
  // endDate set at creation. The form hides the input and shows the
  // current value as read-only text. The submit() change-detection
  // already gates `endDate` on a real diff, so the field is naturally
  // excluded from the PATCH body for custom tournaments. Default to
  // `null` when the prop is absent (safe default — see type def).
  const isCustomTournament = (competition.externalSource ?? null) === null;
  const endDateDisplay = competition.endDate
    ? new Date(competition.endDate).toISOString().slice(0, 16).replace("T", " ")
    : null;

  // Form state. We keep the form in sync with the initial values and
  // re-derive it from the latest `competition` prop when the dialog
  // is re-opened (so a successful save + reopen shows the new data).
  const [name, setName] = useState(competition.name);
  const [endDate, setEndDate] = useState(
    competition.endDate ? toLocalDateTimeInput(competition.endDate) : "",
  );
  const [externalLeagueId, setExternalLeagueId] = useState(
    competition.externalLeagueId ?? "",
  );
  const [externalSeason, setExternalSeason] = useState(
    competition.externalSeason === null ? "" : String(competition.externalSeason),
  );
  const [detailsRaw, setDetailsRaw] = useState(
    competition.details ? JSON.stringify(competition.details, null, 2) : "",
  );
  // Per-stage scoring overrides. Initialized from
  // competition.details.scoringOverridesByStage if set, else empty.
  // Empty state means "no override" — defaults apply at resolve time.
  const [scoringOverrides, setScoringOverrides] = useState<ScoringOverrides>(
    () => extractScoringOverrides(competition.details),
  );

  const reset = () => {
    setName(competition.name);
    setEndDate(competition.endDate ? toLocalDateTimeInput(competition.endDate) : "");
    setExternalLeagueId(competition.externalLeagueId ?? "");
    setExternalSeason(
      competition.externalSeason === null ? "" : String(competition.externalSeason),
    );
    setDetailsRaw(
      competition.details ? JSON.stringify(competition.details, null, 2) : "",
    );
    setScoringOverrides(extractScoringOverrides(competition.details));
    setState({ kind: "idle" });
  };

  const updateScoringOverride = (stage: Stage, field: Field, value: number) => {
    setScoringOverrides((prev) => ({
      ...prev,
      [stage]: { ...(prev[stage] ?? {}), [field]: value },
    }));
  };

  const resetScoringOverrides = () => {
    setScoringOverrides({});
  };

  const submit = () => {
    setState({ kind: "saving" });
    const input: {
      name?: string;
      endDate?: string | null;
      externalLeagueId?: string | null;
      externalSeason?: number | null;
      details?: Record<string, unknown> | null;
    } = {};

    if (name !== competition.name) input.name = name;
    const endDateIso = endDate ? new Date(endDate).toISOString() : null;
    if (
      endDateIso !==
      (competition.endDate ? new Date(competition.endDate).toISOString() : null)
    ) {
      input.endDate = endDateIso;
    }
    if (externalLeagueId !== (competition.externalLeagueId ?? "")) {
      input.externalLeagueId = externalLeagueId || null;
    }
    const seasonNum = externalSeason === "" ? null : Number(externalSeason);
    if (seasonNum !== competition.externalSeason) {
      input.externalSeason = seasonNum;
    }

    // Build the new details object by merging the JSON textarea value
    // with the scoring overrides form state. The form's value takes
    // precedence for the `scoringOverridesByStage` key, but other keys
    // in the JSON (like `area`, `code`, `type` set by the sync) are
    // preserved.
    let detailsObject: Record<string, unknown> = {};
    if (detailsRaw.trim() !== "") {
      try {
        const parsed = JSON.parse(detailsRaw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          setState({ kind: "error", message: "details must be a JSON object" });
          return;
        }
        detailsObject = parsed as Record<string, unknown>;
      } catch (e) {
        setState({ kind: "error", message: "details is not valid JSON" });
        return;
      }
    }

    detailsObject = {
      ...detailsObject,
      scoringOverridesByStage: scoringOverrides,
    };

    if (JSON.stringify(detailsObject) !== JSON.stringify(competition.details ?? null)) {
      input.details = detailsObject;
    }

    if (Object.keys(input).length === 0) {
      setState({ kind: "idle" });
      setOpen(false);
      return;
    }

    startTransition(async () => {
      const result = await patchCompetitionAction(competition.id, input);
      if (result.ok) {
        setState({ kind: "idle" });
        setOpen(false);
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
        onClick={() => {
          if (!open) reset();
          setOpen((v) => !v);
        }}
        className="px-3 py-1 text-xs font-bold border border-muted-foreground/30 text-foreground hover:bg-muted rounded"
      >
        {open ? "Cancel" : "Edit"}
      </button>
      {open && (
        <div className="pitch-card p-3 mt-2 w-80 text-left space-y-2 text-sm z-20">
          <label className="block">
            <span className="text-xs text-muted-foreground">Name</span>
            <input
              className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </label>
          {isCustomTournament ? (
            <div className="block">
              <span className="text-xs text-muted-foreground">
                End date (immutable)
              </span>
              <p
                className="w-full bg-muted/40 border border-border rounded px-2 py-1 text-sm text-muted-foreground"
                data-testid="enddate-readonly"
              >
                {endDateDisplay
                  ? `${endDateDisplay} UTC — set at creation, cannot be changed`
                  : "No end date set — cannot be changed"}
              </p>
            </div>
          ) : (
            <label className="block">
              <span className="text-xs text-muted-foreground">End date</span>
              <input
                type="datetime-local"
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          )}
          <label className="block">
            <span className="text-xs text-muted-foreground">External league id</span>
            <input
              className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
              value={externalLeagueId}
              onChange={(e) => setExternalLeagueId(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">External season</span>
            <input
              type="number"
              className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
              value={externalSeason}
              onChange={(e) => setExternalSeason(e.target.value)}
            />
          </label>
          <details className="border border-border rounded p-2">
            <summary className="text-xs font-medium cursor-pointer">
              Scoring config (per-stage overrides)
            </summary>
            <p className="text-xs text-muted-foreground mt-2 mb-3">
              Change the points awarded for each scoring outcome. New
              values apply to FUTURE scoring only — existing settled
              bets keep their original points. If unset, the default
              scoring applies.
            </p>

            <div className="max-h-80 overflow-y-auto pr-1">
              {STAGES.map((stage) => (
                <div key={stage} className="mb-3">
                  <h4 className="text-xs font-medium mb-1">{stage}</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {FIELDS.map((field) => (
                      <label key={field} className="text-xs flex flex-col">
                        <span className="text-muted-foreground">{field}</span>
                        <input
                          type="number"
                          min="0"
                          value={
                            scoringOverrides[stage]?.[field] ??
                            DEFAULT_SCORING_CONFIG[stage][field]
                          }
                          onChange={(e) =>
                            updateScoringOverride(
                              stage,
                              field,
                              Number(e.target.value),
                            )
                          }
                          className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={resetScoringOverrides}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Reset all to defaults
            </button>
          </details>
          <label className="block">
            <span className="text-xs text-muted-foreground">Details (JSON object)</span>
            <textarea
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono h-24"
              value={detailsRaw}
              onChange={(e) => setDetailsRaw(e.target.value)}
              placeholder='{"branding": {"color": "red"}}'
            />
          </label>
          {state.kind === "error" && (
            <p className="text-xs text-destructive">Save failed: {state.message}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2 py-1 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isPending || state.kind === "saving"}
              className="neon-button px-3 py-1 text-xs"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalDateTimeInput(iso: string): string {
  // <input type="datetime-local"> wants a "YYYY-MM-DDTHH:mm" string in
  // local time. We build it from the ISO so the user sees the
  // already-displayed time, not a UTC shift.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function extractScoringOverrides(
  details: Record<string, unknown> | null,
): ScoringOverrides {
  const raw = details?.scoringOverridesByStage;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ScoringOverrides;
  }
  return {};
}
