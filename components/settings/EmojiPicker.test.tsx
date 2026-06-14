import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EmojiPicker } from "./EmojiPicker";

afterEach(() => cleanup());

describe("EmojiPicker", () => {
  it("renders the current value as the trigger", () => {
    render(<EmojiPicker value="🦅" onChange={() => {}} />);
    expect(screen.getByLabelText("Choose emoji")).toBeInTheDocument();
    expect(screen.getByText("🦅")).toBeInTheDocument();
  });

  it("renders a fallback emoji when value is empty", () => {
    render(<EmojiPicker value="" onChange={() => {}} />);
    expect(screen.getByText("⚽")).toBeInTheDocument();
  });

  it("opens the grid on trigger click", () => {
    render(<EmojiPicker value="🦅" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Choose emoji"));
    // Grid is now visible with the listbox role
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // All 30 emojis are rendered
    const options = screen.getAllByRole("option");
    expect(options.length).toBe(30);
  });

  it("calls onChange with the selected emoji and closes the grid", () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="🦅" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Choose emoji"));
    fireEvent.click(screen.getByRole("option", { name: "🏆" }));
    expect(onChange).toHaveBeenCalledWith("🏆");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("highlights the currently-selected emoji in the grid", () => {
    render(<EmojiPicker value="🦅" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Choose emoji"));
    const selected = screen.getByRole("option", { selected: true });
    expect(selected.textContent).toBe("🦅");
  });

  it("closes the grid when the click-away backdrop is clicked", () => {
    render(<EmojiPicker value="🦅" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Choose emoji"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close emoji picker"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
