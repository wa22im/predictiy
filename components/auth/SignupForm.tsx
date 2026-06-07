"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signupAction, type SignupResult } from "@/app/(app)/signup/actions";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || !password || !confirm) return;

    setState({ kind: "submitting" });

    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", password);
    fd.set("confirmPassword", confirm);

    startTransition(async () => {
      const result: SignupResult = await signupAction(fd);
      if (result.ok) {
        // For now always send to onboarding — the invite cookie (if any)
        // is consumed there. If no invite, the onboarding action redirects
        // to /dashboard on completion.
        router.push(result.redirectTo ?? "/onboarding");
        router.refresh();
      } else {
        setState({ kind: "error", message: result.error ?? "Sign up failed" });
      }
    });
  }

  const passwordsMismatch =
    confirm.length > 0 && password !== confirm;

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

      <div>
        <label htmlFor="password" className="micro-label block mb-2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="micro-label block mb-2">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
          aria-invalid={passwordsMismatch || undefined}
        />
        {passwordsMismatch && (
          <p className="text-destructive text-xs mt-1">
            Passwords do not match
          </p>
        )}
      </div>

      {state.kind === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={
          isPending ||
          state.kind === "submitting" ||
          !email ||
          password.length < 8 ||
          passwordsMismatch
        }
        className="command-strip w-full inline-flex items-center justify-center px-6 py-3 text-base font-bold disabled:opacity-50 disabled:pointer-events-none"
      >
        {state.kind === "submitting" ? "Creating account…" : "Create Account"}
      </button>
    </form>
  );
}
