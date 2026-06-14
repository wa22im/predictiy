import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AppNavbar } from "./AppNavbar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

afterEach(() => cleanup());

describe("AppNavbar", () => {
  it("renders a link for every main app section (Home, Groups, Settings, Admin)", () => {
    render(<AppNavbar user={null} />);
    // The brand <a> uses aria-label "Predicty home" which would also
    // match /Home/i — disambiguate by exact name match.
    expect(
      screen.getByRole("link", { name: "Home" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Groups" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
  });

  it("renders the brand link to the dashboard", () => {
    render(<AppNavbar user={null} />);
    const brand = screen.getByRole("link", { name: /Predicty/ });
    expect(brand).toHaveAttribute("href", "/dashboard");
  });

  it("marks the active route with the primary text color", () => {
    render(<AppNavbar user={null} />);
    // Exact "Home" — the brand link uses aria-label "Predicty home".
    const homeLink = screen.getByRole("link", { name: "Home" });
    expect(homeLink.className).toMatch(/text-primary/);
  });

  it("renders Settings as a real link to /settings (no longer disabled)", () => {
    render(<AppNavbar user={null} />);
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).toBeInTheDocument();
    expect(settings).toHaveAttribute("href", "/settings");
    // The disabled-only cursor-not-allowed class is gone — the link
    // is a normal nav item styled like Home/Groups/Admin.
    expect(settings.className).not.toMatch(/cursor-not-allowed/);
  });
});
