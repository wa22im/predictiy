import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatchClock } from "./match-clock";

describe("MatchClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders countdown digits when kickoff is in the future", () => {
    const now = new Date("2026-06-09T12:00:00Z");
    vi.setSystemTime(now);
    // 1 hour, 5 minutes, 9 seconds in the future.
    const kickoff = new Date(now.getTime() + (3600 + 5 * 60 + 9) * 1000);

    render(<MatchClock kickoffAt={kickoff} />);

    const digits = screen.getByTestId("match-clock-countdown");
    expect(digits).toBeInTheDocument();
    expect(digits).toHaveTextContent(/01\s*:\s*05\s*:\s*09/);
    expect(screen.getByTestId("match-clock")).toHaveAttribute(
      "data-variant",
      "countdown",
    );
  });

  it("renders the FT badge when kickoff is far in the past", () => {
    const now = new Date("2026-06-09T12:00:00Z");
    vi.setSystemTime(now);
    // 5 hours ago — beyond the 2h "live" window.
    const kickoff = new Date(now.getTime() - 5 * 60 * 60 * 1000);

    render(<MatchClock kickoffAt={kickoff} />);

    expect(screen.getByTestId("match-clock-ft")).toBeInTheDocument();
    expect(screen.getByTestId("match-clock")).toHaveAttribute(
      "data-variant",
      "ft",
    );
  });
});
