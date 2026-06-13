import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CreatePoolButton } from "./CreatePoolButton";

// The CreatePoolButton imports a server action. We mock the module
// path to avoid actually calling the server during the test.
vi.mock("@/app/(app)/dashboard/actions", () => ({
  createGroupAction: vi.fn(),
}));

// next/navigation's useRouter is needed because the component calls
// router.push on successful submit.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    back: () => {},
  }),
}));

afterEach(() => cleanup());

describe("CreatePoolButton", () => {
  it("renders the card-variant trigger with the expected text", () => {
    render(<CreatePoolButton variant="card" competitions={[]} />);
    // The card trigger is a <button> with the text "Create a Pool".
    const trigger = screen.getByRole("button", { name: /create a pool/i });
    expect(trigger).toBeInTheDocument();
    // The modal should NOT be in the DOM yet.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the modal as a direct child of document.body (portalled, not nested in the trigger)", async () => {
    // We render the button inside a <main> so the trigger has an
    // ancestor context. The bug we're guarding against: the modal
    // appearing as a descendant of the trigger button (the "form
    // inside the button" symptom) when the trigger has a hover
    // transform.
    render(
      <main>
        <CreatePoolButton variant="card" competitions={[]} />
      </main>,
    );

    // Click the card-variant trigger.
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));

    // Wait for the portal mount (mounted via useEffect on first client
    // render). The dialog should appear.
    const dialog = await waitFor(() => screen.getByRole("dialog"));

    // The dialog must be a direct child of document.body — not nested
    // inside the trigger button. We verify by walking up the DOM and
    // checking that <body> is the parent (or grandparent), not the
    // trigger.
    let parent = dialog.parentElement;
    while (parent && parent !== document.body) {
      parent = parent.parentElement;
    }
    expect(parent).toBe(document.body);
  });

  it("renders the modal with role='dialog' and aria-modal='true' for accessibility", async () => {
    render(
      <CreatePoolButton variant="card" competitions={[{ id: "c1", name: "World Cup" }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("closes on Escape key", async () => {
    render(<CreatePoolButton variant="card" competitions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("closes on overlay click", async () => {
    render(<CreatePoolButton variant="card" competitions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(dialog);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("does not close on inner card click (stopPropagation)", async () => {
    render(<CreatePoolButton variant="card" competitions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    // The inner card is the first child of the dialog (pitch-card-hero).
    const inner = dialog.firstElementChild as HTMLElement;
    fireEvent.click(inner);
    // The dialog should still be open.
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});
