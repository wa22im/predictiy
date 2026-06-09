"use client";

import { useState, useTransition } from "react";
import {
  completeOnboardingAction,
  type OnboardingResult,
} from "@/app/(app)/onboarding/actions";
import { cn } from "@/lib/utils";

export function OnboardingForm({
  initialNickname,
  initialEmoji,
  emojis,
}: {
  initialNickname: string;
  initialEmoji: string;
  emojis: string[];
}) {
  const [nickname, setNickname] = useState(initialNickname);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [error, setError] = useState<OnboardingResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData();
    fd.set("nickname", nickname);
    fd.set("emoji", emoji);

    startTransition(async () => {
      const result = await completeOnboardingAction(fd);
      if (result && !result.ok) {
        setError(result);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="nickname" className="micro-tag block mb-2">
          Nickname
        </label>
        <input
          id="nickname"
          name="nickname"
          type="text"
          required
          autoFocus
          minLength={2}
          maxLength={24}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="alex_lightning"
          className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
        {error?.field === "nickname" && (
          <p className="text-destructive text-xs mt-1">{error.error}</p>
        )}
      </div>

      <div>
        <label className="micro-tag block mb-2">Emoji</label>
        <div className="grid grid-cols-5 gap-2">
          {emojis.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={cn(
                "aspect-square rounded-xl text-2xl flex items-center justify-center transition-all border",
                emoji === e
                  ? "bg-primary/20 border-primary"
                  : "bg-background/40 border-border hover:bg-background/60",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <input type="hidden" name="emoji" value={emoji} />
      </div>

      {error && !error.field && (
        <p className="text-destructive text-sm">{error.error}</p>
      )}

      <button
        type="submit"
        disabled={isPending || nickname.length < 2}
        className="neon-button w-full inline-flex items-center justify-center px-6 py-3 text-base font-bold disabled:opacity-50 disabled:pointer-events-none"
      >
        {isPending ? "Saving…" : "Save Profile"}
      </button>
    </form>
  );
}
