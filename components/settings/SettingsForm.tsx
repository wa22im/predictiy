"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfileAction } from "@/app/(app)/settings/actions";
import { EmojiPicker } from "./EmojiPicker";

export function SettingsForm({
  initialNickname,
  initialEmoji,
  email,
}: {
  initialNickname: string;
  initialEmoji: string;
  email: string;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(initialNickname);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfileAction({ nickname, emoji });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <p className="text-sm text-muted-foreground">{email}</p>
      </div>
      <div>
        <label htmlFor="nickname" className="block text-sm font-medium mb-1">
          Nickname
        </label>
        <input
          id="nickname"
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={40}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Emoji</label>
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <p className="text-xs text-muted-foreground mt-1">
          A single emoji. Shown next to your nickname.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-success">Saved.</p>}
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="neon-button px-4 py-2 text-sm font-bold disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
