"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * 30 curated emojis — sports, trophies, reactions, faces, misc.
 * Curated (not a full Unicode picker) because the use case is "single
 * emoji per user" — a search field and 3000+ options would be
 * overkill. The user can always request a wider picker later.
 */
const EMOJIS = [
  "⚽", "🏀", "🏈", "🎾", "🏐", "🏓",
  "🏸", "🥊", "🏆", "🥇", "🥈", "🥉",
  "🎖", "🔥", "⭐", "❤️", "💪", "👏",
  "🎉", "✨", "😎", "🦅", "🐺", "🦁",
  "🐯", "🐻", "🚀", "🌈", "🎯", "🍕",
] as const;

export function EmojiPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose emoji"
        className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 text-sm hover:bg-muted w-full sm:w-auto"
      >
        <span className="text-lg">{value || "⚽"}</span>
        <span className="text-muted-foreground text-xs">Choose emoji</span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 text-muted-foreground ml-auto transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <button
            type="button"
            aria-label="Close emoji picker"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-label="Emoji"
            className="absolute z-20 mt-1 grid grid-cols-6 gap-1 p-2 rounded-lg border border-border bg-card shadow-lg"
          >
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={emoji === value}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                className={`h-9 w-9 rounded text-lg flex items-center justify-center hover:bg-muted transition-colors ${
                  emoji === value
                    ? "bg-muted ring-2 ring-accent"
                    : ""
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
