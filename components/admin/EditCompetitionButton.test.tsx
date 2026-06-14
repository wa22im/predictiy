import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// The EditCompetitionButton imports a server action. We mock the
// module path so the test never actually hits the network.
const patchCompetitionAction = vi.fn();
vi.mock("@/app/(app)/admin/leagues/actions", () => ({
  patchCompetitionAction: (...args: unknown[]) => patchCompetitionAction(...args),
}));

// next/navigation's useRouter is needed because the component calls
// router.refresh on a successful save.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    back: () => {},
  }),
}));

import { EditCompetitionButton } from "./EditCompetitionButton";

afterEach(() => cleanup());
beforeEach(() => {
  patchCompetitionAction.mockReset();
  patchCompetitionAction.mockResolvedValue({ ok: true, id: "comp-1" });
});

function openModal() {
  fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
  // The modal renders the Name field after open.
  return screen.getByDisplayValue("World Cup 2026");
}

describe("EditCompetitionButton (scoring config section)", () => {
  it("renders the scoring config section as collapsed by default", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "World Cup 2026",
          endDate: null,
          externalLeagueId: null,
          externalSeason: null,
          details: null,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // The <details> summary is rendered. The <details> element is in
    // the DOM but should not be `open` (collapsed) by default — the
    // user has to click the summary to reveal the 42 input cells.
    const summary = screen.getByText(/scoring config \(per-stage overrides\)/i);
    expect(summary).toBeInTheDocument();
    const detailsEl = summary.closest("details") as HTMLDetailsElement;
    expect(detailsEl).toBeInTheDocument();
    expect(detailsEl.open).toBe(false);
  });

  it("expands the section and shows 7 stages × 6 fields with default values", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "World Cup 2026",
          endDate: null,
          externalLeagueId: null,
          externalSeason: null,
          details: null,
        }}
      />,
    );
    openModal();
    // Expand the scoring config <details>.
    fireEvent.click(screen.getByText(/scoring config \(per-stage overrides\)/i));

    // All 7 stage headers should be visible.
    for (const stage of [
      "GROUP_STAGE",
      "ROUND_OF_16",
      "QUARTER_FINAL",
      "SEMI_FINAL",
      "FINAL",
      "THIRD_PLACE",
      "OUTRIGHT",
    ]) {
      expect(screen.getByText(stage)).toBeInTheDocument();
    }

    // 6 active fields appear in every section. Confirm the GROUP_STAGE
    // section shows the default values: exact=5, draw-exact=5, etc.
    const exactInputs = screen.getAllByDisplayValue("5");
    expect(exactInputs.length).toBeGreaterThan(0);
    // GROUP_STAGE.exactScorePoints is "5" per DEFAULT_SCORING_CONFIG.
    const groupExact = screen.getAllByDisplayValue("5");
    expect(groupExact.length).toBeGreaterThan(0);
  });

  it("pre-fills the inputs from competition.details.scoringOverridesByStage when set", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "World Cup 2026",
          endDate: null,
          externalLeagueId: null,
          externalSeason: null,
          details: {
            scoringOverridesByStage: {
              SEMI_FINAL: { exactScorePoints: 9 },
            },
          },
        }}
      />,
    );
    openModal();
    fireEvent.click(screen.getByText(/scoring config \(per-stage overrides\)/i));

    // SEMI_FINAL.exactScorePoints is overridden to 9. Other fields
    // still show the default value.
    const nine = screen.getAllByDisplayValue("9");
    expect(nine.length).toBe(1);
    // SEMI_FINAL also has other default fields (draw-exact=6, etc.).
    const sixes = screen.getAllByDisplayValue("6");
    expect(sixes.length).toBeGreaterThan(0);
  });

  it("'Reset all to defaults' button clears the override state", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "World Cup 2026",
          endDate: null,
          externalLeagueId: null,
          externalSeason: null,
          details: {
            scoringOverridesByStage: {
              SEMI_FINAL: { exactScorePoints: 9 },
            },
          },
        }}
      />,
    );
    openModal();
    fireEvent.click(screen.getByText(/scoring config \(per-stage overrides\)/i));

    // Confirm the override is pre-filled.
    expect(screen.getAllByDisplayValue("9").length).toBe(1);

    // Click reset.
    fireEvent.click(screen.getByRole("button", { name: /reset all to defaults/i }));

    // The override is gone — every input shows the default.
    expect(screen.queryByDisplayValue("9")).toBeNull();
  });

  it("editing a field and saving sends the updated scoringOverridesByStage in details", async () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "World Cup 2026",
          endDate: null,
          externalLeagueId: null,
          externalSeason: null,
          details: { area: { id: 1, name: "Europe" } },
        }}
      />,
    );
    openModal();
    fireEvent.click(screen.getByText(/scoring config \(per-stage overrides\)/i));

    // Find the SEMI_FINAL.exactScorePoints input and change it to 9.
    // The label is "exactScorePoints" inside the SEMI_FINAL section.
    // Use the label-association: get the SEMI_FINAL <h4>, then the
    // first "exactScorePoints" <label> inside it.
    const semiHeader = screen.getByText("SEMI_FINAL");
    const semiContainer = semiHeader.parentElement as HTMLElement;
    const exactLabel = Array.from(semiContainer.querySelectorAll("label")).find(
      (l) => l.textContent?.includes("exactScorePoints"),
    ) as HTMLElement;
    const exactInput = exactLabel.querySelector("input") as HTMLInputElement;
    expect(exactInput).toBeDefined();
    fireEvent.change(exactInput, { target: { value: "9" } });

    // Save.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // Wait for the async action.
    await waitFor(() => {
      expect(patchCompetitionAction).toHaveBeenCalledTimes(1);
    });

    const [, payload] = patchCompetitionAction.mock.calls[0];
    // details should contain the preserved `area` key (from the JSON
    // textarea) AND the new `scoringOverridesByStage` with the edited
    // value.
    expect(payload.details).toBeDefined();
    expect(payload.details.area).toEqual({ id: 1, name: "Europe" });
    expect(payload.details.scoringOverridesByStage).toEqual({
      SEMI_FINAL: { exactScorePoints: 9 },
    });
  });

  it("'Reset all to defaults' sends an empty scoringOverridesByStage {} on save", async () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "World Cup 2026",
          endDate: null,
          externalLeagueId: null,
          externalSeason: null,
          details: {
            scoringOverridesByStage: {
              SEMI_FINAL: { exactScorePoints: 9 },
            },
          },
        }}
      />,
    );
    openModal();
    fireEvent.click(screen.getByText(/scoring config \(per-stage overrides\)/i));
    fireEvent.click(screen.getByRole("button", { name: /reset all to defaults/i }));

    // Save.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(patchCompetitionAction).toHaveBeenCalledTimes(1);
    });

    const [, payload] = patchCompetitionAction.mock.calls[0];
    // The form state is {} (empty), so scoringOverridesByStage is {}.
    // The merge sends `{}` — not undefined, not omitted — so the sync
    // merge will preserve `{}` going forward.
    expect(payload.details.scoringOverridesByStage).toEqual({});
  });
});

describe("EditCompetitionButton (endDate immutability for custom tournaments)", () => {
  it("renders the endDate input when the competition is a vendor (externalSource set)", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "World Cup 2026",
          endDate: "2026-07-19T00:00:00.000Z",
          externalLeagueId: null,
          externalSeason: null,
          details: null,
          externalSource: "football-data",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // The datetime-local input is rendered, and the read-only
    // paragraph is NOT rendered. Match by role+type to avoid
    // timezone-dependent string assertions.
    const input = screen.getByLabelText(/^end date$/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe("datetime-local");
    expect(screen.queryByTestId("enddate-readonly")).toBeNull();
  });

  it("does NOT render the endDate input when the competition is custom (externalSource = null)", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "Custom Cup",
          endDate: "2026-07-19T00:00:00.000Z",
          externalLeagueId: null,
          externalSeason: null,
          details: null,
          externalSource: null,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // No datetime-local input is rendered. The read-only paragraph is
    // shown instead.
    expect(screen.queryByLabelText(/^end date$/i)).toBeNull();
    expect(screen.getByTestId("enddate-readonly")).toBeInTheDocument();
  });

  it("shows the current endDate as read-only text when the competition is custom", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "Custom Cup",
          endDate: "2026-07-19T00:00:00.000Z",
          externalLeagueId: null,
          externalSeason: null,
          details: null,
          externalSource: null,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const readOnly = screen.getByTestId("enddate-readonly");
    expect(readOnly).toBeInTheDocument();
    // The read-only text contains the date (YYYY-MM-DD) and the
    // immutability note. We match on the year-month-day portion to
    // avoid coupling to the exact hour/minute string formatting.
    expect(readOnly.textContent).toMatch(/2026-07-19/);
    expect(readOnly.textContent).toMatch(/cannot be changed/);
  });

  it("shows a 'No end date set' message for custom tournaments with null endDate", () => {
    render(
      <EditCompetitionButton
        competition={{
          id: "comp-1",
          name: "Custom Cup",
          endDate: null,
          externalLeagueId: null,
          externalSeason: null,
          details: null,
          externalSource: null,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const readOnly = screen.getByTestId("enddate-readonly");
    expect(readOnly.textContent).toMatch(/no end date set/i);
  });
});
