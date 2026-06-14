import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CreatePoolButton } from "./CreatePoolButton";

// The CreatePoolButton imports server actions. We mock the module
// path to avoid actually calling the server during the test.
const createGroupAction = vi.fn();
const createPoolWithCustomTournamentAction = vi.fn();
vi.mock("@/app/(app)/dashboard/actions", () => ({
  createGroupAction: (...args: unknown[]) => createGroupAction(...args),
  createPoolWithCustomTournamentAction: (...args: unknown[]) =>
    createPoolWithCustomTournamentAction(...args),
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
beforeEach(() => {
  createGroupAction.mockReset();
  createPoolWithCustomTournamentAction.mockReset();
  // Default: both actions succeed with a stable shape so the
  // happy-path tests don't have to re-mock on every test.
  createGroupAction.mockResolvedValue({ ok: true, groupId: "g1" });
  createPoolWithCustomTournamentAction.mockResolvedValue({
    ok: true,
    id: "g1",
    name: "Friday Crew",
    competitionId: "c-new",
    competitionName: "My Custom Cup",
  });
});

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

describe("CreatePoolButton — tournament source selector", () => {
  // The "Create new custom tournament" round added a mode toggle
  // inside the modal: the user picks either an existing
  // competition (default) or creates a new custom tournament
  // inline. The mode is exposed as radio buttons with text labels
  // — "Use existing tournament" / "Create new custom tournament".
  // The extra fields (new tournament name, end date) only appear
  // in the "Create new" mode.

  it("defaults to the 'Use existing tournament' mode (existing dropdown is visible, new-tournament fields are hidden)", async () => {
    render(
      <CreatePoolButton
        variant="card"
        competitions={[{ id: "c1", name: "World Cup" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    await waitFor(() => screen.getByRole("dialog"));
    // The existing-tournament <select> is visible by default. We
    // target it via its id to disambiguate from the radio buttons
    // (which also contain the word "Tournament" via their labels).
    expect(document.getElementById("competitionId")).toBeInTheDocument();
    // The new-tournament fields are NOT visible in the default mode.
    expect(
      screen.queryByLabelText(/new tournament name/i),
    ).toBeNull();
    expect(screen.queryByLabelText(/end date/i)).toBeNull();
  });

  it("shows the 'Create new custom tournament' option (the new mode toggle)", async () => {
    render(
      <CreatePoolButton
        variant="card"
        competitions={[{ id: "c1", name: "World Cup" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    await waitFor(() => screen.getByRole("dialog"));
    // The mode selector exposes both options as radio buttons.
    expect(
      screen.getByLabelText(/use existing tournament/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/create new custom tournament/i),
    ).toBeInTheDocument();
  });

  it("reveals the new-tournament fields (name, end date) when 'Create new' is selected", async () => {
    render(
      <CreatePoolButton
        variant="card"
        competitions={[{ id: "c1", name: "World Cup" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    await waitFor(() => screen.getByRole("dialog"));
    // Click the "Create new custom tournament" radio.
    fireEvent.click(
      screen.getByLabelText(/create new custom tournament/i),
    );
    // The extra fields appear.
    expect(
      screen.getByLabelText(/new tournament name/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
  });

  it("hides the new-tournament fields again when the user toggles back to 'Use existing'", async () => {
    render(
      <CreatePoolButton
        variant="card"
        competitions={[{ id: "c1", name: "World Cup" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    await waitFor(() => screen.getByRole("dialog"));
    // Switch to new mode.
    fireEvent.click(
      screen.getByLabelText(/create new custom tournament/i),
    );
    expect(
      screen.getByLabelText(/new tournament name/i),
    ).toBeInTheDocument();
    // Switch back to existing mode.
    fireEvent.click(screen.getByLabelText(/use existing tournament/i));
    expect(screen.queryByLabelText(/new tournament name/i)).toBeNull();
  });

  it("calls createPoolWithCustomTournamentAction when 'Create new' is selected and submitted", async () => {
    render(
      <CreatePoolButton
        variant="card"
        competitions={[{ id: "c-existing", name: "World Cup" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    await waitFor(() => screen.getByRole("dialog"));
    // Switch to new mode.
    fireEvent.click(
      screen.getByLabelText(/create new custom tournament/i),
    );
    // Fill in the form.
    fireEvent.change(screen.getByLabelText(/pool name/i), {
      target: { value: "My Friday Crew" },
    });
    fireEvent.change(screen.getByLabelText(/new tournament name/i), {
      target: { value: "My Custom Cup" },
    });
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2026-12-31T23:59" },
    });
    // Submit.
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    // The new endpoint's action was called (not the old
    // createGroupAction).
    await waitFor(() => {
      expect(createPoolWithCustomTournamentAction).toHaveBeenCalled();
    });
    expect(createGroupAction).not.toHaveBeenCalled();
    // The action's payload is the right shape: pool name +
    // newCompetition block, NO competitionId (the XOR).
    expect(createPoolWithCustomTournamentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Friday Crew",
        newCompetition: expect.objectContaining({
          name: "My Custom Cup",
          endDate: expect.any(String),
        }),
      }),
    );
  });

  it("calls createGroupAction (the legacy path) when 'Use existing' is selected and submitted", async () => {
    render(
      <CreatePoolButton
        variant="card"
        competitions={[{ id: "c-existing", name: "World Cup" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create a pool/i }));
    await waitFor(() => screen.getByRole("dialog"));
    // Default mode is "Use existing" — fill the form and submit.
    fireEvent.change(screen.getByLabelText(/pool name/i), {
      target: { value: "My Friday Crew" },
    });
    // The competitionId is a <select> — target it by id to
    // disambiguate from the radio buttons (which have
    // "Tournament" in their label text).
    fireEvent.change(document.getElementById("competitionId") as HTMLSelectElement, {
      target: { value: "c-existing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      expect(createGroupAction).toHaveBeenCalled();
    });
    expect(createPoolWithCustomTournamentAction).not.toHaveBeenCalled();
  });
});
