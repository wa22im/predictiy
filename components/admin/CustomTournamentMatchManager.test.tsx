import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

// The component imports a server action. We mock the module path so
// the test never actually hits the network.
const addMatchesToCompetitionAction = vi.fn();
const removeMatchFromCompetitionAction = vi.fn();
vi.mock("@/app/(app)/admin/leagues/actions", () => ({
  addMatchesToCompetitionAction: (...args: unknown[]) =>
    addMatchesToCompetitionAction(...args),
  removeMatchFromCompetitionAction: (...args: unknown[]) =>
    removeMatchFromCompetitionAction(...args),
}));

// next/navigation's useRouter is needed because the component calls
// router.refresh on success.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    back: () => {},
  }),
}));

import { CustomTournamentMatchManager } from "./CustomTournamentMatchManager";

afterEach(() => cleanup());
beforeEach(() => {
  addMatchesToCompetitionAction.mockReset();
  removeMatchFromCompetitionAction.mockReset();
  addMatchesToCompetitionAction.mockResolvedValue({ ok: true, added: 0, requested: 0 });
  removeMatchFromCompetitionAction.mockResolvedValue({ ok: true, removed: true });
});

const futureKickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function makeProps(overrides: Partial<Parameters<typeof CustomTournamentMatchManager>[0]> = {}) {
  return {
    competitionId: "c1",
    competitionEndDate: null,
    initialMatches: [],
    sourceCompetitions: [
      { id: "src-1", name: "Champions League", externalSource: "football-data" },
    ],
    sourceMatches: [
      { id: "m1", competitionId: "src-1", homeTeam: "Real Madrid", awayTeam: "Liverpool", kickoffTime: futureKickoff, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
      { id: "m2", competitionId: "src-1", homeTeam: "Bayern", awayTeam: "PSG", kickoffTime: futureKickoff, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
      { id: "m3", competitionId: "src-1", homeTeam: "Man City", awayTeam: "Inter", kickoffTime: futureKickoff, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
    ],
    ...overrides,
  };
}

function openModal() {
  fireEvent.click(screen.getByTestId("add-matches-button"));
  // Step 1: pick the source competition. The <select> is labelled
  // "Source competition" (a <label> element with htmlFor), so we
  // target the <select> directly by its id.
  fireEvent.change(document.getElementById("sourceCompetition") as HTMLSelectElement, {
    target: { value: "src-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
}

describe("CustomTournamentMatchManager — Select all checkbox", () => {
  // The step-2 view contains the "Select all" header, the "Show
  // only future matches" filter, and one checkbox per match. Helper
  // to grab just the match checkboxes (the user-toggleable rows).
  function getMatchCheckboxes() {
    const selectAll = screen.getByTestId("select-all-checkbox");
    const futureFilter = screen.getByTestId("only-future-checkbox");
    const allCheckboxes = screen.getAllByRole("checkbox");
    // Exclude the header and the "only future" filter — leave only
    // the per-match checkboxes the user toggles.
    return allCheckboxes.filter(
      (c) => c !== selectAll && c !== futureFilter,
    );
  }

  it("renders the Select all checkbox in step 2", () => {
    render(<CustomTournamentMatchManager {...makeProps()} />);
    openModal();
    expect(screen.getByTestId("select-all-checkbox")).toBeInTheDocument();
    expect(screen.getByText(/select all \(3\)/i)).toBeInTheDocument();
  });

  it("starts unchecked when nothing is selected", () => {
    render(<CustomTournamentMatchManager {...makeProps()} />);
    openModal();
    const selectAll = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);
  });

  it("clicking Select all checks every visible match checkbox", () => {
    render(<CustomTournamentMatchManager {...makeProps()} />);
    openModal();
    const selectAll = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    fireEvent.click(selectAll);
    // The header's checked attribute should now be true.
    expect(selectAll.checked).toBe(true);
    // Every match checkbox should be checked.
    const matchCheckboxes = getMatchCheckboxes();
    expect(matchCheckboxes.length).toBe(3);
    for (const cb of matchCheckboxes) {
      expect((cb as HTMLInputElement).checked).toBe(true);
    }
    // Counter at the bottom should show 3.
    expect(screen.getByText(/3 matches selected/i)).toBeInTheDocument();
  });

  it("clicking Select all again unchecks every visible match checkbox", () => {
    render(<CustomTournamentMatchManager {...makeProps()} />);
    openModal();
    const selectAll = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    // First click → all on
    fireEvent.click(selectAll);
    // Second click → all off
    fireEvent.click(selectAll);
    expect(selectAll.checked).toBe(false);
    const matchCheckboxes = getMatchCheckboxes();
    for (const cb of matchCheckboxes) {
      expect((cb as HTMLInputElement).checked).toBe(false);
    }
    expect(screen.getByText(/0 matches selected/i)).toBeInTheDocument();
  });

  it("enters the indeterminate state when the user manually picks a partial subset", () => {
    render(<CustomTournamentMatchManager {...makeProps()} />);
    openModal();
    // The header should start unchecked + not-indeterminate.
    const selectAll = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(false);

    // Click ONE of the three match checkboxes (the first one — Real Madrid).
    const matchCheckboxes = getMatchCheckboxes();
    fireEvent.click(matchCheckboxes[0]);

    // The header should now be in the indeterminate state.
    // Note: React only re-renders the `checked` prop, but the
    // `indeterminate` DOM attribute is set via a useEffect → ref in
    // the component. We assert on the DOM attribute directly. The
    // effect runs synchronously in test environments under
    // @testing-library/react, so the post-click check is reliable.
    expect(selectAll.indeterminate).toBe(true);
    // The header checkbox's `checked` prop is still false (only
    // some are picked, not all).
    expect(selectAll.checked).toBe(false);
  });

  it("clears the indeterminate state when all picks are toggled off", () => {
    render(<CustomTournamentMatchManager {...makeProps()} />);
    openModal();
    const selectAll = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    const matchCheckboxes = getMatchCheckboxes();

    // Pick one → indeterminate.
    fireEvent.click(matchCheckboxes[0]);
    expect(selectAll.indeterminate).toBe(true);
    // Toggle it off → indeterminate cleared.
    fireEvent.click(matchCheckboxes[0]);
    expect(selectAll.indeterminate).toBe(false);
    expect(selectAll.checked).toBe(false);
  });

  it("flips to fully checked (not indeterminate) when the last unchecked match is toggled on", () => {
    render(<CustomTournamentMatchManager {...makeProps()} />);
    openModal();
    const selectAll = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    const matchCheckboxes = getMatchCheckboxes();

    // Use Select all to pick everything.
    fireEvent.click(selectAll);
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);

    // Toggle one off → indeterminate.
    fireEvent.click(matchCheckboxes[0]);
    expect(selectAll.indeterminate).toBe(true);

    // Toggle the same one back on → fully checked again.
    fireEvent.click(matchCheckboxes[0]);
    expect(selectAll.indeterminate).toBe(false);
    expect(selectAll.checked).toBe(true);
  });
});

describe("CustomTournamentMatchManager — 1-hour buffer + endDate filter", () => {
  // The "Add matches" modal hides matches the server will reject:
  //   - matches whose kickoffTime is within MIN_HOURS_BEFORE_KICKOFF
  //     of now (server returns 400 MATCH_TOO_CLOSE)
  //   - matches whose kickoffTime is past the tournament's endDate
  //     (server returns 400 MATCH_AFTER_ENDDATE)
  // The filter is the "Show only future matches" toggle, on by
  // default. Untick to see all matches (the server is still the
  // gate — picking a match the server rejects surfaces a 400 in
  // the error state).

  const in30Min = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const in2Hours = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const in10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  function getMatchCheckboxes() {
    const selectAll = screen.getByTestId("select-all-checkbox");
    const futureFilter = screen.getByTestId("only-future-checkbox");
    const allCheckboxes = screen.getAllByRole("checkbox");
    return allCheckboxes.filter(
      (c) => c !== selectAll && c !== futureFilter,
    );
  }

  it("hides matches within the 1-hour buffer (kickoff 30 min from now)", () => {
    render(
      <CustomTournamentMatchManager
        {...makeProps({
          sourceMatches: [
            { id: "m-too-close", competitionId: "src-1", homeTeam: "TooClose", awayTeam: "X", kickoffTime: in30Min, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
            { id: "m-ok", competitionId: "src-1", homeTeam: "OK", awayTeam: "Y", kickoffTime: in2Hours, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
          ],
        })}
      />,
    );
    openModal();
    // The match inside the 1-hour buffer is filtered out; the
    // other one is visible.
    const checkboxes = getMatchCheckboxes();
    expect(checkboxes).toHaveLength(1);
  });

  it("hides matches past the tournament's endDate (when competitionEndDate is set)", () => {
    render(
      <CustomTournamentMatchManager
        {...makeProps({
          competitionEndDate: in7Days,
          sourceMatches: [
            { id: "m-3d", competitionId: "src-1", homeTeam: "ThreeDay", awayTeam: "X", kickoffTime: in3Days, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
            { id: "m-10d", competitionId: "src-1", homeTeam: "TenDay", awayTeam: "Y", kickoffTime: in10Days, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
          ],
        })}
      />,
    );
    openModal();
    // The 3-day match is before the 7-day endDate → visible.
    // The 10-day match is past the endDate → hidden.
    const checkboxes = getMatchCheckboxes();
    expect(checkboxes).toHaveLength(1);
  });

  it("does not filter by endDate when competitionEndDate is null (vendor tournaments)", () => {
    render(
      <CustomTournamentMatchManager
        {...makeProps({
          competitionEndDate: null,
          sourceMatches: [
            { id: "m-10d", competitionId: "src-1", homeTeam: "TenDay", awayTeam: "Y", kickoffTime: in10Days, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
          ],
        })}
      />,
    );
    openModal();
    // No endDate → no endDate filtering. Only the 1-hour buffer
    // applies, and the 10-day match is past that.
    const checkboxes = getMatchCheckboxes();
    expect(checkboxes).toHaveLength(1);
  });

  it("'Show only future matches' toggle is on by default (the filter is the safe default)", () => {
    render(
      <CustomTournamentMatchManager
        {...makeProps({
          sourceMatches: [
            { id: "m-future", competitionId: "src-1", homeTeam: "Future", awayTeam: "X", kickoffTime: in2Hours, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
            { id: "m-past", competitionId: "src-1", homeTeam: "Past", awayTeam: "Y", kickoffTime: in30Min, status: "SCHEDULED" as const, homeCrest: null, awayCrest: null },
          ],
        })}
      />,
    );
    openModal();
    // Default: onlyFuture is on → only the future match is visible.
    const filter = screen.getByTestId("only-future-checkbox") as HTMLInputElement;
    expect(filter.checked).toBe(true);
    const checkboxes = getMatchCheckboxes();
    expect(checkboxes).toHaveLength(1);
  });
});
