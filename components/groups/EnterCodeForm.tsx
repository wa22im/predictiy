"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hash } from "lucide-react";
import { joinByCodeAction } from "@/app/(app)/dashboard/actions";

export function EnterCodeForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const inputId = "enter-code-input";
  const errorId = "enter-code-error";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const normalized = code.trim().toUpperCase();
    if (normalized.length < 8 || normalized.length > 32) {
      setError("Code must be 8–32 characters.");
      return;
    }

    startTransition(async () => {
      const result = await joinByCodeAction({ inviteCode: normalized });
      if (result.ok) {
        router.push(`/groups/${result.groupId}`);
      } else if (result.error === "AUTH_REQUIRED") {
        router.push("/login?invited=1");
      } else if (result.error === "RATE_LIMITED") {
        const seconds = Math.ceil((result.retryAfterMs ?? 0) / 1000);
        setError(`Too many attempts. Try again in ${seconds}s.`);
      } else if (result.error === "NOT_FOUND") {
        setError("That code didn't match any pool. Check and try again.");
      } else if (result.error === "INVALID_CODE") {
        setError("Code must be 8–32 characters.");
      } else {
        setError("Something went wrong. Try again.");
      }
    });
  }

  const trimmedLen = code.trim().length;

  return (
    <form
      onSubmit={handleSubmit}
      aria-describedby={error ? errorId : undefined}
      className="pitch-card p-3 w-full"
    >
      <div className="flex flex-row gap-2">
        <div className="relative flex-1">
          <Hash
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
          />
          <input
            id={inputId}
            name="inviteCode"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck="false"
            maxLength={32}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC12345"
            disabled={isPending}
            className="w-full rounded-xl bg-background/40 border border-border pl-9 pr-3 py-1.5 font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={isPending || trimmedLen < 8}
          className="neon-button-flat px-5 py-1.5 text-sm font-bold disabled:opacity-50 disabled:pointer-events-none"
        >
          {isPending ? "Joining…" : "Join"}
        </button>
      </div>
      <p
        id={errorId}
        ref={errorRef}
        role="alert"
        className={
          error
            ? "text-sm text-destructive mt-2"
            : "text-sm text-destructive mt-2 sr-only"
        }
      >
        {error ?? ""}
      </p>
    </form>
  );
}
