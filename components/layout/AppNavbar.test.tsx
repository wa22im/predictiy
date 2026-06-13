import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AppNavbar } from "./AppNavbar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

afterEach(() => cleanup());

describe("AppNavbar", () => {
  it("renders a link for every main app section (Dashboard, Groups, Leaderboard, Admin)", () => {
    render(<AppNavbar user={null} />);
    expect(
      screen.getByRole("link", { name: /Dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Groups/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Leaderboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Admin/i })).toBeInTheDocument();
  });

  it("renders the brand link to the dashboard", () => {
    render(<AppNavbar user={null} />);
    const brand = screen.getByRole("link", { name: /Predicty/ });
    expect(brand).toHaveAttribute("href", "/dashboard");
  });

  it("marks the active route with the primary text color", () => {
    render(<AppNavbar user={null} />);
    const dashboardLink = screen.getByRole("link", { name: /Dashboard/i });
    expect(dashboardLink.className).toMatch(/text-primary/);
  });
});
