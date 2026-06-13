import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DashboardTabs } from "./DashboardTabs";
import type { DashboardGroup } from "@/lib/services/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    back: () => {},
  }),
}));

afterEach(() => cleanup());

function makeGroup(over: Partial<DashboardGroup> = {}): DashboardGroup {
  return {
    id: "g1",
    name: "Group A",
    competitionName: "World Cup",
    memberCount: 4,
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        homeCrest: null,
        awayCrest: null,
        kickoffTime: "2026-06-13T20:00:00Z",
        stage: "GROUP",
        status: "SCHEDULED",
        isLocked: false,
        timeUntilLockMs: 600_000,
        homeScore: null,
        awayScore: null,
        homeHtGoals: null,
        awayHtGoals: null,
        homePenalties: null,
        awayPenalties: null,
        markets: [],
        isFinished: false,
      },
    ],
    ...over,
  };
}

describe("DashboardTabs", () => {
  it("renders nothing when there are no active groups", () => {
    const { container } = render(
      <DashboardTabs groups={[]} serverNow="2026-06-13T19:00:00Z" lockdownMs={300_000} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the first group's name and matches by default", () => {
    render(
      <DashboardTabs
        groups={[makeGroup({ id: "g1", name: "Group A" })]}
        serverNow="2026-06-13T19:00:00Z"
        lockdownMs={300_000}
      />,
    );
    // Group A appears as both the active tab and the panel title.
    expect(screen.getAllByText(/Group A/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/World Cup/)).toBeInTheDocument();
    // The match within the group surfaces in the panel.
    expect(screen.getByText("Arsenal")).toBeInTheDocument();
  });

  it("cycles to the next group when the right arrow is clicked", () => {
    render(
      <DashboardTabs
        groups={[
          makeGroup({ id: "g1", name: "Group A" }),
          makeGroup({ id: "g2", name: "Group B" }),
        ]}
        serverNow="2026-06-13T19:00:00Z"
        lockdownMs={300_000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    // After clicking next, Group B's name appears in the panel.
    expect(screen.getAllByText(/Group B/).length).toBeGreaterThanOrEqual(1);
  });

  it("cycles to the previous group when the left arrow is clicked", () => {
    render(
      <DashboardTabs
        groups={[
          makeGroup({ id: "g1", name: "Group A" }),
          makeGroup({ id: "g2", name: "Group B" }),
        ]}
        serverNow="2026-06-13T19:00:00Z"
        lockdownMs={300_000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous pool" }));
    // Wraps from g1 (index 0) → g2 (last).
    expect(screen.getAllByText(/Group B/).length).toBeGreaterThanOrEqual(1);
  });

  it("links the group title to the group detail page", () => {
    render(
      <DashboardTabs
        groups={[makeGroup({ id: "group-xyz", name: "Group A" })]}
        serverNow="2026-06-13T19:00:00Z"
        lockdownMs={300_000}
      />,
    );
    // There are two links with "Group A": the title and "View all matches...".
    // We want the title link which should go to /groups/group-xyz.
    const titleLinks = screen.getAllByRole("link", { name: /Group A/ }).filter(link =>
      link.getAttribute("href") === "/groups/group-xyz"
    );
    expect(titleLinks.length).toBeGreaterThan(0);
  });

  it("resets the betting form state when navigating to a different group", () => {
    // Regression: MatchBettingForm uses useState(initialPicks) where
    // initialPicks derives from match.markets[].viewerBet. useState only
    // runs the initializer on first mount, so a reused form instance
    // would keep the first group's picks. The fix keys each <MatchCard>
    // with `${activeGroup.id}-${match.id}` so the form remounts on tab
    // change. This test exercises the full path: A (with bet) → B (no
    // bet) → A (with bet), asserting the input state resets and
    // round-trips.
    const matchWithBet = {
      id: "m-shared",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      homeCrest: null,
      awayCrest: null,
      kickoffTime: "2026-06-14T20:00:00Z",
      stage: "GROUP",
      status: "SCHEDULED" as const,
      isLocked: false,
      timeUntilLockMs: 600_000,
      homeScore: null,
      awayScore: null,
      homeHtGoals: null,
      awayHtGoals: null,
      homePenalties: null,
      awayPenalties: null,
      markets: [
        {
          id: "mk-shared",
          type: "EXACT_SCORE",
          title: "Predict the final score",
          options: null,
          correctAnswer: null,
          isSettled: false,
          viewerBet: { predictedValue: "1-0", pointsAwarded: null },
          otherBets: [],
        },
      ],
      isFinished: false,
    };
    const matchNoBet = {
      ...matchWithBet,
      markets: [
        { ...matchWithBet.markets[0], viewerBet: null },
      ],
    };

    render(
      <DashboardTabs
        groups={[
          makeGroup({ id: "gA", name: "Group A", matches: [matchWithBet] }),
          makeGroup({ id: "gB", name: "Group B", matches: [matchNoBet] }),
        ]}
        serverNow="2026-06-14T19:00:00Z"
        lockdownMs={300_000}
      />,
    );

    // On group A: the saved bet "1-0" is reflected in the score input
    // (home-score field shows "1").
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();

    // Navigate to group B.
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));

    // On group B: the input must be empty — the "1" from group A must
    // not leak into the freshly-mounted form for group B.
    expect(screen.queryByDisplayValue("1")).toBeNull();
    expect(screen.queryByDisplayValue("0")).toBeNull();
    // The two EXACT_SCORE inputs are still rendered, just empty.
    const spinbuttons = screen.getAllByRole("spinbutton");
    expect(spinbuttons.length).toBe(2);
    expect(spinbuttons[0]).toHaveValue(null);
    expect(spinbuttons[1]).toHaveValue(null);

    // Navigate back to group A.
    fireEvent.click(screen.getByRole("button", { name: "Previous pool" }));

    // Round-trip integrity: the saved bet "1-0" is back.
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0")).toBeInTheDocument();
  });
});
