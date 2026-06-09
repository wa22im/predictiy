import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBug } from "./score-bug";

describe("ScoreBug", () => {
  it("renders scheduled status with kickoff time and scores", () => {
    render(
      <ScoreBug
        home="Arsenal"
        away="Chelsea"
        homeScore={2}
        awayScore={1}
        status="scheduled"
        kickoffAt="2026-06-09T20:00:00Z"
      />,
    );

    expect(screen.getByText("Arsenal")).toBeInTheDocument();
    expect(screen.getByText("Chelsea")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/KO 20:00/)).toBeInTheDocument();
  });

  it("renders em-dash placeholders for null scores and shows FT badge", () => {
    render(
      <ScoreBug
        home="Liverpool"
        away="Everton"
        homeScore={null}
        awayScore={null}
        status="ft"
      />,
    );

    expect(screen.getByText("FT")).toBeInTheDocument();
    expect(screen.getByText("Liverpool")).toBeInTheDocument();
    expect(screen.getByText("Everton")).toBeInTheDocument();
    // The em-dash placeholder is rendered for each null score slot.
    const dashes = screen.getAllByText("\u2013");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
