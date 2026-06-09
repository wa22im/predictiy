"use client";

import { useState } from "react";

export function InviteBanner({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/join/${inviteCode}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text
    }
  }

  return (
    <div className="pitch-card p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="micro-tag mb-1">Invite</p>
        <p className="font-mono text-sm truncate">{url}</p>
      </div>
      <button
        onClick={copy}
        className="neon-button px-4 py-2 text-sm font-bold whitespace-nowrap"
      >
        {copied ? "✓ Copied" : "📋 Copy"}
      </button>
    </div>
  );
}
