# Design System

EA FC / FIFA Ultimate Team visual system for predicty. Dark, neon, tiered. The interface borrows the broadcast language of football trading cards: deep ink canvas, fiery red primary, hot gold/yellow accent, magenta and gold highlights, and a rating-tier system (bronze → silver → gold → IF → TOTW) that maps rarity to color and treatment. A cool blue `--locked` token marks frozen / no-action states, sitting chromatically between muted-foreground and destructive.

---

## Stack

- **Framework:** Next.js 15.5.19 App Router + React 19.2.7 + TypeScript
- **Styling:** Tailwind CSS v4 via `@theme inline` in `app/globals.css` (no `tailwind.config.*`)
- **Components:** shadcn-style primitives in `components/ui`, plus a new `components/football/*` directory of football-specific primitives
- **Icons:** Lucide React
- **Fonts:** Inter (body, via `next/font/google`), Barlow Condensed (display, via `next/font/google`), IBM Plex Mono (mono, via `next/font/google`)
- **Dark mode:** system-driven, dark is the visual default. A light token set is shipped for completeness but is not the target mode.
- **Tests:** Vitest with jsdom + `@testing-library/react` and `@testing-library/jest-dom`
- **Utilities:** `cn()` from `@/lib/utils`

---

## Visual Direction

The app is a football broadcast, not a generic SaaS dashboard.

- **Canvas:** near-black with a cool tint (`--background`); warm-white text (`--foreground`) for paper-like readability.
- **Primary:** fiery neon red (`--primary`) — used for CTAs, win states, and live indicators. The dominant brand hue.
- **Accent:** hot gold/yellow (`--accent`) — used for focus rings, info highlights, and the gradient pivot in `neon-button`. Trophy-on-pitch.
- **Success:** warm pale yellow (`--success`) — intentionally one shade lighter and warmer than `--accent` so the trophy semantic reads distinct from primary action. Both read as "gold" to the eye, but accent is "press this" and success is "you won."
- **Locked:** cool gray-blue (`--locked`) — chromatically between `--muted-foreground` and `--destructive`, used for frozen / no-action states (e.g. a match that's past kickoff but not yet settled).
- **Highlights:** magenta (`--magenta`) for inform / TOTW moments; gold (`--gold`) for rating tiers and rewards.
- **Motifs:** angular / diagonal cuts for hero moments, rounded-2xl corners on cards, mono eyebrows for technical metadata.
- **Type:** tight, condensed, sporty display (Barlow Condensed) for headings; clean sans (Inter) for everything else; mono (IBM Plex Mono) for labels, codes, and timestamps.
- **What to avoid:** generic purple/white gradients, flat gray panels, amber-tinted desk aesthetics, paper overlays.

The system reaches for three utility classes for the bulk of surfaces: `pitch-card` (default cards), `pitch-card-hero` (high-impact hero/header panels), and `neon-button` (primary CTAs).

---

## Tokens

All semantic tokens live in `app/globals.css` and are bridged to Tailwind with `@theme inline`. Light and dark both defined; dark is the default.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `background` | `oklch(0.96 0.01 90)` | `oklch(0.12 0.02 250)` | Page canvas |
| `foreground` | `oklch(0.18 0.02 250)` | `oklch(0.96 0.02 90)` | Primary text |
| `card` | `oklch(0.99 0.005 90 / 92%)` | `oklch(0.18 0.025 250 / 80%)` | Card surface |
| `popover` | `oklch(0.99 0.005 90 / 96%)` | `oklch(0.20 0.025 250 / 90%)` | Popover/menu surface |
| `primary` | `oklch(0.62 0.24 25)` | `oklch(0.65 0.24 25)` | Fiery red primary CTA |
| `primary-foreground` | `oklch(0.15 0.02 25)` | `oklch(0.15 0.02 25)` | Text on primary |
| `accent` | `oklch(0.82 0.18 90)` | `oklch(0.85 0.18 90)` | Hot gold accent, focus ring |
| `accent-foreground` | `oklch(0.15 0.02 90)` | `oklch(0.15 0.02 90)` | Text on accent |
| `secondary` | `oklch(0.92 0.01 90 / 86%)` | `oklch(0.22 0.03 250 / 80%)` | Secondary surfaces |
| `secondary-foreground` | `oklch(0.18 0.02 250)` | `oklch(0.96 0.02 90)` | Text on secondary |
| `muted` | `oklch(0.90 0.01 90 / 70%)` | `oklch(0.24 0.025 250 / 60%)` | Subtle surfaces |
| `muted-foreground` | `oklch(0.48 0.02 250)` | `oklch(0.72 0.02 90)` | Supporting copy |
| `border` | `oklch(0.20 0.02 250 / 14%)` | `oklch(0.98 0.01 90 / 12%)` | Borders, input borders |
| `input` | `oklch(0.20 0.02 250 / 14%)` | `oklch(0.98 0.01 90 / 12%)` | Input borders |
| `ring` | `oklch(0.82 0.18 90)` | `oklch(0.85 0.18 90)` | Focus ring |
| `destructive` | `oklch(0.60 0.22 28)` | `oklch(0.65 0.22 28)` | Destructive actions |
| `destructive-foreground` | `oklch(0.15 0.02 28)` | `oklch(0.15 0.02 28)` | Text on destructive |
| `success` | `oklch(0.88 0.16 95)` | `oklch(0.88 0.16 95)` | Won / trophy state (warm pale yellow) |
| `warning` | `oklch(0.78 0.18 80)` | `oklch(0.78 0.18 80)` | Warning state |
| `locked` | `oklch(0.55 0.10 250)` | `oklch(0.55 0.10 250)` | Frozen / no-action state (cool gray-blue). Bridged as `--color-locked` in `@theme inline`. |
| `overlay` | `oklch(0 0 0 / 0.55)` | `oklch(0 0 0 / 0.6)` | Modal backdrop |
| `gold` | `oklch(0.82 0.16 85)` | `oklch(0.82 0.16 85)` | Rating-tier gold, rewards |
| `magenta` | `oklch(0.68 0.24 340)` | `oklch(0.68 0.24 340)` | Inform / TOTW highlight |

### State colors

State tokens are semantically distinct. A state never borrows from another state's role:

| State | Token | Visual | Meaning |
| --- | --- | --- | --- |
| Action | `--primary` | Fiery red | "Press this." Primary CTAs, live indicators, has-bet state borders. |
| Won / Trophy | `--success` | Warm pale yellow | "You won." Settlement wins, completed milestones. Intentionally one shade lighter and warmer than `--accent` so the trophy semantic reads distinct from primary action. |
| Caution | `--warning` | Amber | Something needs attention but is not destructive. |
| Frozen | `--locked` | Cool gray-blue | The system is in a non-actionable state (kickoff passed, league locked, etc.). Sits chromatically between `--muted-foreground` and `--destructive`. |
| Error / Delete | `--destructive` | Red-orange | Destructive actions, validation errors. |

The success-vs-accent near-collision is intentional. Both read as "gold" to the eye, but accent is the "press this" CTA hue and success is the "you won" trophy hue. They are not the same token and they should never be used interchangeably: accent drives a button or a focus ring, success drives a settlement label or a winning-state border.

### Rating tiers

| Token | Value | Usage |
| --- | --- | --- |
| `rating-tier-bronze` | `oklch(0.62 0.12 60)` | Common, low-rated card |
| `rating-tier-silver` | `oklch(0.78 0.02 250)` | Uncommon, mid-rated card |
| `rating-tier-gold` | `var(--gold)` | Rare, high-rated card |
| `rating-tier-if` | `oklch(0.65 0.22 28)` | Inform (in-form) variant |
| `rating-tier-totw` | `var(--magenta)` | Team of the Week |

### Charts

`chart-1` through `chart-5` use the accent palette in order: primary red, gold, magenta, gold, coral.

---

## Typography

| Token | Font | Usage |
| --- | --- | --- |
| `--font-body` | Inter (400/500/600/700) | Body text, controls, forms |
| `--font-display` | Barlow Condensed (600/700/800/900) | Hero headings, card titles, scorebug numerals |
| `--font-mono` | IBM Plex Mono (400/500/600/700) | Labels, codes, technical metadata |

The class name `font-display` is preserved and re-pointed via `--font-display: var(--font-barlow-condensed)` in `@theme inline`, so every existing `className="font-display"` call site automatically picks up the new face with no class-name churn.

The `heading-display` utility is the canonical pattern for hero moments:

```tsx
<h1 className="heading-display text-6xl md:text-8xl text-foreground">
  predicty
</h1>
```

Display headings default to `font-display tracking-tight uppercase` for scorebugs, section headers, and card titles. Body copy stays readable with `leading-7` or `leading-8`. Technical eyebrows use `.micro-tag`.

---

## Core Utilities

Defined in `app/globals.css`. Every utility consumes semantic tokens — no hex, no raw oklch inside the utility bodies.

- **`.pitch-card`** — translucent dark card with a thin neon top-border accent (red → gold → magenta gradient), rounded-2xl, subtle inner highlight. The default card treatment.
- **`.pitch-card-hero`** — high-impact variant of `pitch-card` with stronger red glow, a thicker neon top-border, and a deeper drop shadow. Use for hero surfaces, page headers, and the public landing hero panel.
- **`.neon-button`** — pill-shaped CTA with a red → gold → magenta gradient, dark text, hover lift, focus ring. The default primary button.
- **`.neon-button-flat`** — single-color flat neon button (solid `--primary` red), pill-shaped, with hover brighten and focus ring. Use for secondary red actions that need to read as "still primary" without the gradient.
- **`.micro-tag`** — uppercase mono label with a neon outline. The eyebrow / badge / system-state style. Replaces ad-hoc uppercase mono spans.
- **`.heading-display`** — `font-display uppercase tracking-tight font-extrabold` with a tight `line-height: 0.95`. The hero-heading pattern.

---

## Components

Football-specific primitives live in `components/football/*` and are re-exported from a barrel.

### ScoreBug

Broadcast-style score chip used in headers, match cards, and leaderboard rows.

```tsx
import { ScoreBug } from "@/components/football";

<ScoreBug
  home="ARS"
  away="CHE"
  homeScore={2}
  awayScore={1}
  status="live"
/>
```

### CrestSlot

Fixed-size circular/square slot for team crests. Falls back to the team initials when no image is provided. `tint` optionally tints the fallback background with a team color.

```tsx
import { CrestSlot } from "@/components/football";

<CrestSlot name="Arsenal" size="md" tint="oklch(0.78 0.22 145)" />
```

### PitchBg

Full-bleed background component with a subtle pitch-line SVG. Use behind hero surfaces, the public landing, and any section that needs a stadium-line motif.

```tsx
import { PitchBg } from "@/components/football";

<section className="relative isolate">
  <PitchBg />
  <div className="relative">…</div>
</section>
```

### MatchClock

Kickoff countdown, live clock, or FT badge. One component, three variants.

```tsx
import { MatchClock } from "@/components/football";

<MatchClock kickoffAt={new Date("2026-06-10T19:00:00Z")} variant="countdown" />
<MatchClock kickoffAt={kickoff} variant="live" />
<MatchClock kickoffAt={kickoff} variant="ft" />
```

### KitSwatch

Two-swatch home/away kit color slot per team. Optional `crestSrc` overlays the home swatch with the team crest.

```tsx
import { KitSwatch } from "@/components/football";

<KitSwatch
  primary="oklch(0.78 0.22 145)"
  secondary="oklch(0.20 0.02 250)"
  crestSrc="/crests/arsenal.png"
/>
```

---

## Rating Tiers

The rating-tier system is the rarity/chemistry language of the app. Each tier maps to a token, a treatment, and a use case.

- **Bronze** (`--rating-tier-bronze`) — common, low-rated. Use for filler cards, base-tier badges, and "default member" indicators.
- **Silver** (`--rating-tier-silver`) — uncommon, mid-rated. Use for standard active members and mid-tier achievements.
- **Gold** (`--rating-tier-gold` / `--gold`) — rare, high-rated. Use for top-of-leaderboard members, perfect-prediction badges, and reward moments.
- **IF / Inform** (`--rating-tier-if`) — red-orange. Use for in-form players, hot streaks, and "current form" highlights.
- **TOTW / Team of the Week** (`--rating-tier-totw` / `--magenta`) — magenta. Use sparingly, for weekly honors and special highlights.

A tier typically appears as a `micro-tag` with the tier color applied to the border and text. Avoid stacking more than one tier color in the same row.

---

## Layout

Use a wide planning workspace:

```tsx
<main className="min-h-screen flex-1 overflow-hidden">
  <div className="container mx-auto max-w-[1500px] px-4 py-8 lg:py-12">
```

The main planner grid uses a sticky left rail and a wider right workspace:

```tsx
grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]
```

Mobile remains single-column with no sticky behavior. Hero sections stack vertically. The public landing uses a centered single-column with `PitchBg` behind the hero panel.

---

## Interaction

- **Hover lift:** `hover:-translate-y-0.5` or the `neon-button` built-in `translateY(-2px)` on hover.
- **Focus:** `focus-visible:ring-ring/50 focus-visible:ring-[3px]` for inputs; the `neon-button` and `neon-button-flat` utilities include their own focus ring.
- **Disabled:** `disabled:pointer-events-none disabled:opacity-50` for buttons; the `neon-button` and `neon-button-flat` utilities include this.
- **Page entrance:** keep motion subtle. Avoid decorative loops that distract from prediction entry.
- **Live indicators:** the scorebug live state pulses the primary color; do not animate other primary CTAs simultaneously.

---

## Accessibility

- Visible focus rings on every interactive control (the `neon-button` utilities include a gold focus ring following `--ring`; inputs use `focus-visible:ring-ring/50`).
- Maintain a 4.5:1 text contrast on translucent panels. `--card-foreground` on `--card` is verified for AA in both modes.
- Provide text representations for any purely visual indicator (live, TOTW, gold tier) — never color alone.
- Respect `prefers-reduced-motion`: gate hover-lift and pulse animations behind a media query when shipping motion.
- Controls must remain usable on mobile, especially add/remove/edit actions on the betting form.
