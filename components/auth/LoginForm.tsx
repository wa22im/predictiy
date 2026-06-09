"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginAction } from "@/app/(app)/login/actions";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function LoginForm({
  initialError,
}: {
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>(
    initialError ? { kind: "error", message: initialError } : { kind: "idle" },
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || !password) return;

    setState({ kind: "submitting" });

    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", password);

    startTransition(async () => {
      const result = await loginAction(fd);
      if (result.ok) {
        // The action returns the correct destination: a joined group if
        // there was a pending invite, else /dashboard.
        router.push(result.redirectTo ?? "/dashboard");
        router.refresh();
      } else {
        setState({ kind: "error", message: result.error ?? "Sign in failed" });
      }
    });
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="micro-tag block mb-2">
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

        <div>
          <label htmlFor="password" className="micro-tag block mb-2">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
        </div>

        {state.kind === "error" && (
          <p className="text-destructive text-sm">{state.message}</p>
        )}

        <button
          type="submit"
          disabled={isPending || state.kind === "submitting"}
          className="neon-button w-full inline-flex items-center justify-center px-6 py-3 text-base font-bold disabled:opacity-50 disabled:pointer-events-none"
        >
          {state.kind === "submitting" ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </>
  );
}
