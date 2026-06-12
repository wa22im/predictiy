import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PitchBgProps = {
  children: ReactNode;
  variant?: "canvas" | "hero";
  className?: string;
};

/**
 * Full-bleed pitch background. Two variants:
 *  - `canvas` (default): faint 24px grid + neon radial tints. Used as the
 *    ambient surface behind dense content.
 *  - `hero`: full pitch diagram (touchlines, halfway line, center circle,
 *    penalty boxes). Used for landing/hero surfaces.
 *
 * Server-compatible: no client state. Stroke color comes from the
 * `--foreground` token via `currentColor` so all pitch lines inherit the
 * system text color (and therefore the system light/dark mode).
 */
export function PitchBg({
  children,
  variant = "canvas",
  className,
}: PitchBgProps) {
  return (
    <div
      className={cn("relative isolate min-h-full text-foreground", className)}
    >
      {variant === "canvas" ? <CanvasLayer /> : <HeroLayer />}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function CanvasLayer() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        backgroundImage: [
          "linear-gradient(to right, var(--border) 1px, transparent 1px)",
          "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          ].join(", "),
        backgroundSize: "24px 24px, 24px 24px, 100% 100%, 100% 100%",
        backgroundPosition: "0 0, 0 0, 0 0, 0 0",
      }}
    />
  );
}

function HeroLayer() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 100 60"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.12"
        strokeWidth="0.25"
        vectorEffect="non-scaling-stroke"
      >
        <rect x="2" y="2" width="96" height="56" />
        <line x1="50" y1="2" x2="50" y2="58" />
        <circle cx="50" cy="30" r="6.7" />
        <rect x="2" y="18" width="14" height="24" />
        <rect x="84" y="18" width="14" height="24" />
      </g>
    </svg>
  );
}
