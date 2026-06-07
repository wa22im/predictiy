"use client";

import { useState, useTransition } from "react";
import { loginAction } from "@/app/(app)/login/actions";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function LoginForm({
  redirect: redirectPath,
  initialError,
}: {
  redirect?: string;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>(
    initialError ? { kind: "error", message: initialError } : { kind: "idle" },
  );
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;

    setState({ kind: "sending" });
    startTransition(async () => {
      const result = await loginAction(new FormData(e.currentTarget));
      if (result.ok) {
        setState({ kind: "sent" });
      } else {
        setState({ kind: "error", message: result.error ?? "Failed" });
      }
    });
  }

  if (state.kind === "sent") {
    return (
      <div className="text-center py-4">
        <p className="font-display text-2xl tracking-tight mb-2">
          Check your inbox
        </p>
        <p className="text-muted-foreground text-sm leading-6">
          We sent a magic link to <span className="font-mono">{email}</span>.
          Click it to sign in.
        </p>
        {redirectPath && (
          <p className="text-xs text-muted-foreground mt-3 font-mono">
            → {redirectPath}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="micro-label block mb-2">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
      </div>

      {state.kind === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={isPending || state.kind === "sending"}
        className="command-strip w-full inline-flex items-center justify-center px-6 py-3 text-base font-bold disabled:opacity-50 disabled:pointer-events-none"
      >
        {state.kind === "sending" ? "Sending…" : "Send Magic Link"}
      </button>
    </form>
  );
}
