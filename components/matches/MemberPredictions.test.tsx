import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemberPredictions } from "./MemberPredictions";
import type { FeedOtherBet } from "@/lib/services/group-feed";

afterEach(() => cleanup());

function makeBets(n: number): FeedOtherBet[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${i + 1}`,
    nickname: `Player${i + 1}`,
    emoji: "⚽",
    predictedValue: `${i}-${i}`,
    isMasked: false,
  }));
}

describe("MemberPredictions", () => {
  it("renders nothing when there are no other bets", () => {
    const { container } = render(<MemberPredictions otherBets={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders all bets without a toggle when the list is short (<= 3)", () => {
    render(<MemberPredictions otherBets={makeBets(2)} />);
    expect(screen.getByText(/Player1/)).toBeInTheDocument();
    expect(screen.getByText(/Player2/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show less/i })).toBeNull();
  });

  it("shows the 'Show all' toggle when the list is long (> 3)", () => {
    render(<MemberPredictions otherBets={makeBets(5)} />);
    const toggle = screen.getByRole("button", { name: /Show all/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent("5");
  });

  it("expands the list to show every bet when 'Show all' is clicked", () => {
    render(<MemberPredictions otherBets={makeBets(5)} />);
    fireEvent.click(screen.getByRole("button", { name: /Show all/i }));
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(new RegExp(`Player${i}`))).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: /Show less/i }),
    ).toBeInTheDocument();
  });

  it("collapses back to the first 3 when 'Show less' is clicked", () => {
    render(<MemberPredictions otherBets={makeBets(5)} />);
    fireEvent.click(screen.getByRole("button", { name: /Show all/i }));
    fireEvent.click(screen.getByRole("button", { name: /Show less/i }));
    expect(screen.getByText(/Player1/)).toBeInTheDocument();
    expect(screen.getByText(/Player2/)).toBeInTheDocument();
    expect(screen.getByText(/Player3/)).toBeInTheDocument();
    expect(screen.queryByText(/Player4/)).toBeNull();
    expect(screen.queryByText(/Player5/)).toBeNull();
  });
});
