import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MatchList } from "./MatchList";
import type { FeedMatch } from "@/lib/services/group-feed";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    back: () => {},
  }),
}));

afterEach(() => cleanup());

function makeMatch(over: Partial<FeedMatch>): FeedMatch {
  return {
    id: over.id ?? "m",
    homeTeam: over.homeTeam ?? "A",
    awayTeam: over.awayTeam ?? "B",
    homeCrest: null,
    awayCrest: null,
    kickoffTime: over.kickoffTime ?? new Date().toISOString(),
    stage: "GROUP",
    status: over.status ?? "SCHEDULED",
    externalStatus: over.externalStatus ?? null,
    isLocked: over.isLocked ?? false,
    timeUntilLockMs: 0,
    homeScore: null,
    awayScore: null,
    homeHtGoals: null,
    awayHtGoals: null,
    homePenalties: null,
    awayPenalties: null,
    markets: [],
    ...over,
  };
}

describe("MatchList day-open behavior", () => {
  it("opens the 3 OLDEST day-groups that have at least one unsettled match; others stay closed", () => {
    // 4 days relative to "now" — each day is one kickoff time slot.
    //   - 3 days ago: 1 unsettled → OPEN (oldest unsettled day)
    //   - 2 days ago: 1 unsettled → OPEN
    //   - Yesterday: 1 unsettled → OPEN
    //   - Today: 2 unsettled → CLOSED (only the 3 oldest unsettled
    //     days are open by default; "today" is the 4th oldest and
    //     gets dropped from the default-open set).
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);

    const matches: FeedMatch[] = [
      makeMatch({ id: "t1", homeTeam: "T1-Home", status: "SCHEDULED", kickoffTime: today.toISOString() }),
      makeMatch({ id: "t2", homeTeam: "T2-Home", status: "GOING", kickoffTime: today.toISOString() }),
      makeMatch({ id: "y1", homeTeam: "Y1-Home", status: "SCHEDULED", kickoffTime: yesterday.toISOString() }),
      makeMatch({ id: "tw1", homeTeam: "TW1-Home", status: "SCHEDULED", kickoffTime: twoDaysAgo.toISOString() }),
      makeMatch({ id: "th1", homeTeam: "TH1-Home", status: "SCHEDULED", kickoffTime: threeDaysAgo.toISOString() }),
    ];

    render(
      <MatchList
        matches={matches}
        serverNow={today.toISOString()}
        lockdownMs={300_000}
        groupId="g1"
      />,
    );

    // The 3 oldest unsettled days should be open (their match cards rendered).
    expect(screen.getByText("TH1-Home")).toBeInTheDocument();
    expect(screen.getByText("TW1-Home")).toBeInTheDocument();
    expect(screen.getByText("Y1-Home")).toBeInTheDocument();
    // Today is the 4th-oldest unsettled day → closed; its matches are not in the DOM.
    expect(screen.queryByText("T1-Home")).toBeNull();
    expect(screen.queryByText("T2-Home")).toBeNull();
  });

  it("defaults fully-past days (all matches FINISHED) to closed", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);

    const matches: FeedMatch[] = [
      // Today: 1 unsettled → OPEN (counts toward the 3)
      makeMatch({ id: "t1", homeTeam: "T1-Home", status: "SCHEDULED", kickoffTime: today.toISOString() }),
      // Yesterday: 1 unsettled → OPEN
      makeMatch({ id: "y1", homeTeam: "Y1-Home", status: "SCHEDULED", kickoffTime: yesterday.toISOString() }),
      // 2 days ago: all FINISHED → CLOSED
      makeMatch({ id: "tw1", homeTeam: "TW1-Home", status: "FINISHED", kickoffTime: twoDaysAgo.toISOString() }),
      makeMatch({ id: "tw2", homeTeam: "TW2-Home", status: "FINISHED", kickoffTime: twoDaysAgo.toISOString() }),
      // 3 days ago: all FINISHED → CLOSED
      makeMatch({ id: "th1", homeTeam: "TH1-Home", status: "FINISHED", kickoffTime: threeDaysAgo.toISOString() }),
    ];

    render(
      <MatchList
        matches={matches}
        serverNow={today.toISOString()}
        lockdownMs={300_000}
        groupId="g1"
      />,
    );

    // Today and yesterday are open.
    expect(screen.getByText("T1-Home")).toBeInTheDocument();
    expect(screen.getByText("Y1-Home")).toBeInTheDocument();
    // 2 and 3 days ago are closed (FINISHED-only days).
    expect(screen.queryByText("TW1-Home")).toBeNull();
    expect(screen.queryByText("TH1-Home")).toBeNull();
  });

  it("orders day-groups chronologically (oldest first)", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

    const matches: FeedMatch[] = [
      // Pass matches in kickoffTime ASC order (the upstream getGroupFeed
      // order). The component should re-rank by distance-from-today
      // DESCENDING, so the oldest day (2 days ago) is at the top.
      makeMatch({ id: "tw1", homeTeam: "TW1-Home", status: "SCHEDULED", kickoffTime: twoDaysAgo.toISOString() }),
      makeMatch({ id: "y1", homeTeam: "Y1-Home", status: "SCHEDULED", kickoffTime: yesterday.toISOString() }),
      makeMatch({ id: "t1", homeTeam: "T1-Home", status: "SCHEDULED", kickoffTime: today.toISOString() }),
    ];

    render(
      <MatchList
        matches={matches}
        serverNow={today.toISOString()}
        lockdownMs={300_000}
        groupId="g1"
      />,
    );

    // All 3 days have unsettled matches → all 3 are open by default.
    expect(screen.getByText("T1-Home")).toBeInTheDocument();
    expect(screen.getByText("Y1-Home")).toBeInTheDocument();
    expect(screen.getByText("TW1-Home")).toBeInTheDocument();

    // The order in the DOM should be oldest first: tw1 (2 days ago)
    // before y1 (yesterday) before t1 (today). Use document position
    // comparison via compareDocumentOrder.
    const t1 = screen.getByText("T1-Home");
    const y1 = screen.getByText("Y1-Home");
    const tw1 = screen.getByText("TW1-Home");
    // Assert tw1 is positioned before y1, and y1 before t1.
    expect(tw1.compareDocumentPosition(y1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(y1.compareDocumentPosition(t1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("MatchList today-highlight", () => {
  // The principal wants the day-group whose date matches "today" to
  // stand out: a left border + tinted background + "Today ·" prefix.
  // The component computes `todayDayString` from `new Date()` with
  // the same formatter as groupByDay, so we drive both the system
  // clock and the match kickoffTime off a fixed instant.
  beforeEach(() => {
    // Pin "now" to a known weekday so the formatted "Today · "
    // string is reproducible. 2026-06-15 is a Monday (per
    // calendar; pick any fixed Mon in the test window).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });

  afterEach(() => {
    // Restore real timers so the global afterEach(cleanup) and any
    // other tests in the suite are unaffected.
    vi.useRealTimers();
  });

  it("applies the today-highlight class to today's day-group button and prefixes the label with 'Today · '", () => {
    // Two days: today and yesterday. Both have unsettled matches so
    // both buttons render in the DOM.
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    const matches: FeedMatch[] = [
      makeMatch({ id: "t1", homeTeam: "T1-Home", status: "SCHEDULED", kickoffTime: today.toISOString() }),
      makeMatch({ id: "y1", homeTeam: "Y1-Home", status: "SCHEDULED", kickoffTime: yesterday.toISOString() }),
    ];

    render(
      <MatchList
        matches={matches}
        serverNow={today.toISOString()}
        lockdownMs={300_000}
        groupId="g1"
      />,
    );

    // Compute the day string the component uses, so the assertion is
    // exact (avoids relying on a hand-formatted string).
    const todayLabel = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "UTC",
    });
    const yesterdayLabel = new Date(yesterday).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "UTC",
    });

    // Today's button has the accent border + tinted background.
    const todayButton = screen.getByRole("button", { name: new RegExp(`^Today · ${todayLabel} ·`) });
    expect(todayButton).toHaveClass("bg-accent/15");
    expect(todayButton).toHaveClass("border-l-4");
    expect(todayButton).toHaveClass("border-accent");

    // Yesterday's button uses the default background (no accent).
    const yesterdayButton = screen.getByRole("button", { name: new RegExp(`^${yesterdayLabel} ·`) });
    expect(yesterdayButton).toHaveClass("bg-background/80");
    expect(yesterdayButton).not.toHaveClass("border-l-4");
  });
});
