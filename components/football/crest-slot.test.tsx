import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrestSlot } from "./crest-slot";

describe("CrestSlot", () => {
  it("renders initials fallback when src is null", () => {
    render(<CrestSlot src={null} name="Manchester United" />);
    // Two-word name → two initials.
    expect(screen.getByText("MU")).toBeInTheDocument();
  });

  it("applies the gold ring when tint is set to gold", () => {
    const { container } = render(
      <CrestSlot src={null} name="Arsenal" tint="gold" />,
    );
    const slot = container.firstElementChild as HTMLElement;
    expect(slot).toBeInTheDocument();
    // The ring is implemented via the Tailwind ring-2 utility
    // referencing the gold CSS variable. We assert the className
    // contains the gold ring utility so the visual updates to a
    // gold ring.
    expect(slot.className).toMatch(/ring-\[var\(--rating-tier-gold\)\]/);
  });
});
