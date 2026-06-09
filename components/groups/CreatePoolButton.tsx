"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGroupAction } from "@/app/(app)/dashboard/actions";
import { cn } from "@/lib/utils";

type Competition = { id: string; name: string };

export function CreatePoolButton({
  competitions,
  variant = "button",
}: {
  competitions?: Competition[];
  variant?: "button" | "card";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    const competitionId = fd.get("competitionId") as string;

    startTransition(async () => {
      const result = await createGroupAction({ name, competitionId });
      if (result.ok) {
        setOpen(false);
        router.push(`/groups/${result.groupId}`);
      } else {
        setError(result.error ?? "Failed to create pool");
      }
    });
  }

  return (
    <>
      {variant === "button" ? (
        <button
          onClick={() => setOpen(true)}
          className="neon-button inline-flex items-center justify-center px-6 py-3 text-base font-bold"
        >
          ➕ Create a Tournament Pool
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="pitch-card-fut p-6 hover:-translate-y-0.5 transition-transform text-left"
        >
          <p className="font-display text-2xl font-bold tracking-tight mb-2">
            ➕ Create a Pool
          </p>
          <p className="text-muted-foreground text-sm">
            Start a new tournament pool.
          </p>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm"
          onClick={() => !isPending && setOpen(false)}
        >
          <div
            className="pitch-card-hero p-6 md:p-8 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="micro-tag mb-2">New Pool</p>
            <h2 className="font-display text-3xl tracking-tight mb-6">
              Create a Tournament Pool
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="micro-tag block mb-2">
                  Pool name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  minLength={1}
                  maxLength={80}
                  autoFocus
                  placeholder="The Friday Night Crew"
                  className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>

              <div>
                <label htmlFor="competitionId" className="micro-tag block mb-2">
                  Tournament
                </label>
                <select
                  id="competitionId"
                  name="competitionId"
                  required
                  className="w-full rounded-xl bg-background/40 border border-border p-3 focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  <option value="">Select a tournament…</option>
                  {competitions?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {(!competitions || competitions.length === 0) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No tournaments yet — ask an admin to sync one.
                  </p>
                )}
              </div>

              {error && (
                <p className="text-destructive text-sm">{error}</p>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="rounded-xl px-4 py-2 text-sm border border-border hover:bg-background/60 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className={cn(
                    "neon-button px-5 py-2 text-sm font-bold",
                    isPending && "opacity-50 pointer-events-none",
                  )}
                >
                  {isPending ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
