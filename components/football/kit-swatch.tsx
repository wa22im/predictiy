"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export type KitSwatchProps = {
  primary: string;
  secondary: string;
  crestSrc?: string | null;
  className?: string;
};

const SIZE_PX = 40;

/**
 * Two-tone kit swatch: upper-left triangle is the `primary` color, the
 * lower-right is the `secondary` color. This is the one primitive in
 * `components/football/` that accepts raw color strings (kit colors are
 * data the system does not own).
 */
export function KitSwatch({
  primary,
  secondary,
  crestSrc,
  className,
}: KitSwatchProps) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border",
        className,
      )}
      style={{
        width: SIZE_PX,
        height: SIZE_PX,
        backgroundImage: `linear-gradient(to top right, ${secondary} 0%, ${secondary} 49.9%, ${primary} 50%, ${primary} 100%)`,
      }}
      aria-label="Team kit colors"
      role="img"
    >
      {crestSrc ? (
        <span
          className="relative inline-block overflow-hidden rounded-sm"
          style={{ width: SIZE_PX * 0.6, height: SIZE_PX * 0.6 }}
        >
          <Image
            src={crestSrc}
            alt="Team crest"
            fill
            sizes="24px"
            className="object-contain"
          />
        </span>
      ) : null}
    </span>
  );
}
