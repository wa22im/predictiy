"use client";

import { useState } from "react";
import { Share2, Link2, Hash } from "lucide-react";

export function ShareInvite({ inviteCode }: { inviteCode: string }) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/join/${inviteCode}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback: select the text manually
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback: select the text manually
    }
  }

  return (
    <details className="pitch-card overflow-hidden group">
      <summary className="cursor-pointer list-none p-4 flex items-center gap-3 hover:bg-secondary/40 transition-colors">
        <Share2 aria-hidden="true" className="h-5 w-5 text-accent" />
        <span className="font-display font-bold tracking-tight">
          Invite more people
        </span>
        <span
          aria-hidden="true"
          className="ml-auto text-muted-foreground text-sm group-open:rotate-180 transition-transform"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-border p-4 space-y-4">
        <div className="space-y-2">
          <p className="micro-tag">Share link</p>
          <p className="font-mono text-sm break-all bg-secondary/30 p-2 rounded">
            {url}
          </p>
          <button
            type="button"
            onClick={copyLink}
            className="neon-button-flat px-4 py-2 text-sm font-bold inline-flex items-center gap-2"
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            {linkCopied ? "✓ Copied" : "Copy link"}
          </button>
        </div>
        <div className="space-y-2">
          <p className="micro-tag">Share code</p>
          <p className="font-mono text-2xl tracking-widest font-bold text-foreground select-all break-all">
            {inviteCode}
          </p>
          <button
            type="button"
            onClick={copyCode}
            className="neon-button-flat px-4 py-2 text-sm font-bold inline-flex items-center gap-2"
          >
            <Hash aria-hidden="true" className="h-4 w-4" />
            {codeCopied ? "✓ Copied" : "Copy code"}
          </button>
        </div>
      </div>
    </details>
  );
}
