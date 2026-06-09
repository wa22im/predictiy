"use client";

import { useState, useTransition } from "react";
import type { AdminUserView } from "@/lib/types/admin";
import { setAdminRole } from "@/app/(app)/admin/users/actions";
import { cn } from "@/lib/utils";

export function AdminUserRow({
  user,
  isSelf,
}: {
  user: AdminUserView;
  isSelf: boolean;
}) {
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    const formData = new FormData();
    formData.set("targetUserId", user.id);
    formData.set("isAdmin", String(!isAdmin));
    startTransition(async () => {
      const result = await setAdminRole(formData);
      if (result.ok) {
        setIsAdmin(result.isAdmin);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <li className="pitch-card p-4 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-2xl shrink-0">{user.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">
            {user.nickname || "(no nickname)"}{" "}
            {isSelf && (
              <span className="text-xs text-muted-foreground">(you)</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {user.email}
          </p>
        </div>
        <span
          className={cn(
            "text-xs font-mono uppercase tracking-widest px-2 py-1 rounded shrink-0",
            isAdmin
              ? "bg-primary/15 text-primary border border-primary/30"
              : "border border-border text-muted-foreground",
          )}
        >
          {isAdmin ? "admin" : "member"}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {user.groups} group{user.groups === 1 ? "" : "s"} · {user.bets} bet
          {user.bets === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={isPending || isSelf}
          className={cn(
            "text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50 disabled:cursor-not-allowed",
            isAdmin ? "text-destructive" : "text-primary",
          )}
        >
          {isPending
            ? "Saving…"
            : isAdmin
              ? "Revoke admin"
              : "Promote to admin"}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}
