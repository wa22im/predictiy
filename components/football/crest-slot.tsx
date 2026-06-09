"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import type { CrestSize, RatingTier } from "./types";

const SIZE_PX: Record<CrestSize, number> = {
  sm: 24,
  md: 40,
  lg: 64,
};

const TINT_RING: Record<RatingTier, string> = {
  bronze: "ring-[var(--rating-tier-bronze)]",
  silver: "ring-[var(--rating-tier-silver)]",
  gold: "ring-[var(--rating-tier-gold)]",
  if: "ring-[var(--rating-tier-if)]",
  totw: "ring-[var(--rating-tier-totw)]",
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0)).join("").toUpperCase() || "?";
}

export type CrestSlotProps = {
  src?: string | null;
  name: string;
  size?: CrestSize;
  tint?: RatingTier | null;
  className?: string;
};

export function CrestSlot({
  src,
  name,
  size = "md",
  tint = null,
  className,
}: CrestSlotProps) {
  const px = SIZE_PX[size];
  const showImage = typeof src === "string" && src.length > 0;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary",
        tint !== null && "ring-2",
        tint !== null && TINT_RING[tint],
        className,
      )}
      style={{ width: px, height: px }}
      aria-label={name}
      role="img"
    >
      {showImage ? (
        <Image
          src={src as string}
          alt={name}
          fill
          sizes={`${px}px`}
          className="object-contain"
        />
      ) : (
        <span className="font-display font-bold text-foreground leading-none">
          {initialsFromName(name)}
        </span>
      )}
    </span>
  );
}

export default CrestSlot;
