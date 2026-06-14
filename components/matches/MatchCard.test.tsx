import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MatchCard } from "./MatchCard";
import type { FeedMatch } from "@/lib/services/group-feed";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    back: () => {},
  }),
}));

afterEach(() => cleanup());

function baseMatch(overrides: Partial<FeedMatch> = {}): FeedMatch {
  return {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    homeCrest: null,
    awayCrest: null,
    kickoffTime: "2026-06-09T20:00:00Z",
    stage: "GROUP",
    status: "SCHEDULED",
    externalStatus: null,
    isLocked: false,
    timeUntilLockMs: 600_000,
    homeScore: null,
    awayScore: null,
    homeHtGoals: null,
    awayHtGoals: null,
    homePenalties: null,
    awayPenalties: null,
    markets: [],
    ...overrides,
  };
}

function finishedMatch(
  viewerPicks: Record<string, { predictedValue: string; pointsAwarded: number | null }>,
  correctAnswers: Record<string, string>,
): FeedMatch {
  return baseMatch({
    status: "FINISHED",
    isLocked: true,
    homeScore: 2,
    awayScore: 1,
    markets: [
      {
        id: "mk1",
        type: "EXACT_SCORE",
        title: "Predict the final score",
        options: null,
        correctAnswer: correctAnswers.mk1 ?? null,
        isSettled: true,
        viewerBet: viewerPicks.mk1 ?? null,
        otherBets: [],
      },
    ],
  });
}

describe("MatchCard", () => {
  it("does not show the success indicator when the match is not FINISHED", () => {
    render(
      <MatchCard
        match={baseMatch()}
        serverNow="2026-06-09T19:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    expect(screen.queryByLabelText("Correct prediction")).toBeNull();
  });

  it("does not show the success indicator when FINISHED but the viewer missed", () => {
    render(
      <MatchCard
        match={finishedMatch(
          { mk1: { predictedValue: "3-0", pointsAwarded: 0 } },
          { mk1: "2-1" },
        )}
        serverNow="2026-06-09T22:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    expect(screen.queryByLabelText("Correct prediction")).toBeNull();
  });

  it("shows the success indicator (CheckCircle2) when the viewer's pick matches the correct answer", () => {
    render(
      <MatchCard
        match={finishedMatch(
          { mk1: { predictedValue: "2-1", pointsAwarded: 5 } },
          { mk1: "2-1" },
        )}
        serverNow="2026-06-09T22:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    expect(screen.getByLabelText("Correct prediction")).toBeInTheDocument();
  });

  it("does not show the success indicator when FINISHED and the viewer placed no bet", () => {
    render(
      <MatchCard
        match={finishedMatch({}, { mk1: "2-1" })}
        serverNow="2026-06-09T22:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    expect(screen.queryByLabelText("Correct prediction")).toBeNull();
  });
});

describe("MatchCard — game status + bet indicators (3-row layout)", () => {
  // The "MatchCard update" round changed the card from a 2-row
  // layout (teams + score+status) to a 3-row layout:
  //   Row 1 — teams + crests (unchanged)
  //   Row 2 — score (left) + GAME STATUS (right, prominent, same
  //           visual weight as the score)
  //   Row 3 — bet indicators (Locked, Settled) — small, dim, secondary
  //
  // The game status comes from `match.externalStatus` first, with
  // a fallback to a derived label from the typed `status` field:
  //   FINISHED → "Final"
  //   GOING → "Live"
  //   SCHEDULED → kickoff time formatted
  //
  // The bet indicators used to live next to the score (as a
  // micro-tag); they move to a separate row, smaller, dimmer.

  it("shows the provider's externalStatus verbatim (e.g. 'HT 1-0', '2H 78\\'') on the score row", () => {
    render(
      <MatchCard
        match={baseMatch({
          status: "GOING",
          homeScore: 1,
          awayScore: 0,
          externalStatus: "HT",
        })}
        serverNow="2026-06-09T20:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    // The externalStatus ("HT") is shown next to the score in the
    // score row — same visual weight as the score, per the ISC.
    expect(screen.getByText("HT")).toBeInTheDocument();
  });

  it("falls back to 'Final' when status=FINISHED and externalStatus is null", () => {
    render(
      <MatchCard
        match={baseMatch({
          status: "FINISHED",
          isLocked: true,
          homeScore: 2,
          awayScore: 1,
          externalStatus: null,
        })}
        serverNow="2026-06-09T22:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("falls back to 'Live' when status=GOING and externalStatus is null", () => {
    render(
      <MatchCard
        match={baseMatch({
          status: "GOING",
          homeScore: 0,
          awayScore: 0,
          externalStatus: null,
        })}
        serverNow="2026-06-09T20:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("falls back to the kickoff time when status=SCHEDULED and externalStatus is null", () => {
    render(
      <MatchCard
        match={baseMatch({
          status: "SCHEDULED",
          kickoffTime: "2026-06-09T20:00:00Z",
          externalStatus: null,
        })}
        serverNow="2026-06-09T19:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    // The fallback for SCHEDULED is the kickoff time formatted in
    // UTC. formatUtc("2026-06-09T20:00:00Z") → "Tue 09 Jun, 20:00 UTC".
    expect(screen.getByText(/Tue 09 Jun, 20:00 UTC/)).toBeInTheDocument();
  });

  it("moves the 'Settled' bet indicator to a separate row (not next to the score)", () => {
    // The Settled indicator used to be a micro-tag on the score
    // row. It now lives in a separate, dimmer row.
    render(
      <MatchCard
        match={finishedMatch(
          { mk1: { predictedValue: "2-1", pointsAwarded: 5 } },
          { mk1: "2-1" },
        )}
        serverNow="2026-06-09T22:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    // The Settled text is still in the DOM…
    const settled = screen.getByText("Settled");
    expect(settled).toBeInTheDocument();
    // …but it should be smaller (not a micro-tag) and dimmer.
    // The new row uses `text-[10px] text-muted-foreground` (or
    // similar) — we assert it's NOT carrying the `micro-tag`
    // class, which is the old 2-row layout's marker.
    expect(settled.className).not.toContain("micro-tag");
  });

  it("moves the 'Locked' bet indicator to a separate row (not next to the score)", () => {
    // Locked: the 5-min save lockdown is in effect (the
    // MatchBettingForm disables its submit, and the
    // `match.isLocked` flag is true). The status badge used to
    // be a micro-tag on the score row.
    render(
      <MatchCard
        match={baseMatch({
          isLocked: true,
          status: "SCHEDULED",
        })}
        serverNow="2026-06-09T20:00:00Z"
        lockdownMs={300_000}
        groupId="g1"
      />,
    );
    const locked = screen.getByText("Locked");
    expect(locked).toBeInTheDocument();
    expect(locked.className).not.toContain("micro-tag");
  });
});
