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
