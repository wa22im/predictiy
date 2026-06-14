# AGENTS.md — Project context for predicty

<!-- BEGIN:nextjs-agent-rules -->
## Next.js version

This project uses **Next.js 15.5.19** (stable backport) and **React 19.2.7** (latest stable). These are the versions your training data knows — no breaking changes expected.

If upgrading Next.js in the future, check `NEXTJS16_NOTES.md` first for known gotchas.
<!-- END:nextjs-agent-rules -->

---

## What is predicty?

A prediction-pool web app for football tournaments. Users create or join a "pool" for a competition (e.g. Premier League, World Cup), predict outcomes for each match (exact score, half-time scoring, in-game penalties), and earn points based on how accurate the predictions are. Leaderboards rank pool members. Pre-launch, small user base (max 10 tournaments).

One-line pitch: *"Premier League, but you put money where your mouth is."*

---

## Tech stack (canonical versions)

- **Next.js 15.5.19** (App Router) + **React 19.2.7**
- **TypeScript** (strict)
- **Prisma 7** with `@prisma/adapter-pg` (TS-source client, NOT the default JS client). Migrations live in `prisma/migrations/`
- **Supabase** (Postgres + email/password auth via `@supabase/ssr`)
- **Tailwind CSS v4** (no `tailwind.config.*`; tokens are bridged in `app/globals.css` via `@theme inline`)
- **Zod** for request validation
- **Lucide React** for icons
- **Vitest** with jsdom + `@testing-library/react` for tests
- **Vercel** for hosting. Cron jobs are driven by **GitHub Actions** (see DEPLOY.md), NOT Vercel Cron (`vercel.json` is now `{}`)

## Data sources

- **football-data.org** — the canonical data source for competitions, matches, scores. Free tier: 10 req/min. Token in `FOOTBALL_DATA_TOKEN` env var.
- **api-football.com** — the LEGACY pipeline (`lib/services/ingest-league.ts`) is **dead**. The cron skips it. Don't extend it.

---

## Architecture

### Directory layout

```
app/                  — Next.js App Router (server components + route handlers + server actions)
  (app)/              — Authenticated routes (have navbar + auth)
    admin/            — Admin-only (gated by requireAdmin in routes)
    dashboard/        — Home page (groups + recent matches)
    groups/           — User's groups + group detail + matches
    settings/         — Profile settings (nickname + emoji)
  api/v1/             — Public API routes (route handlers, not server actions)
    admin/            — Admin endpoints
    cron/             — Cron endpoints (Bearer-token auth)
    matches/          — Live polling endpoint
components/          — React components
  football/           — Football-specific primitives (ScoreBug, CrestSlot, MatchClock, etc.)
  groups/             — Group-related components
  matches/            — Match cards and lists
  settings/           — Settings form components
  ui/                 — Generic shadcn-style primitives
lib/
  services/           — Business logic (per-domain service files)
  scoring/            — Scoring strategies + config resolution
  supabase/           — Supabase SSR client
  prisma.ts           — The Prisma singleton
prisma/
  schema.prisma       — The schema (User, Group, GroupMember, Competition, Match, BetMarket, UserBet, etc.)
  migrations/         — Schema migrations
scripts/              — CLI admin/maintenance tools
specs/                — Specs (currently just README.md)
```

### Key patterns

- **Server actions for forms**, **route handlers for API** (the UI calls the API via the action which internally fetches its own route — see "Cookie forwarding" gotcha below).
- **Service layer in `lib/services/`** — one file per domain (dashboard, groups, settle-market, sync-football-data-competition, etc.). Service functions do business logic and DB calls; route handlers and server actions are thin wrappers.
- **Prisma includes for relations** — keep queries flat. Use `select` to limit fields; use `include` only when you need the relation in the same response.
- **JSONB `details` columns** for forward-compat — every model (User, Group, Competition, Match, BetMarket) has a `details Json?` column. New feature flags, scoring overrides, group creator tracking, and other ad-hoc metadata go here rather than typed columns. **Backward compatible by design.**
- **Resolve config pattern** for scoring — `lib/services/scoring/resolve-config.ts` merges configs from 4 sources in precedence order: `Match.details > Competition.details > Group.scoringConfig > Default`. Use this when you need the effective scoring config for a match.

### Cookie forwarding gotcha — READ THIS

Server actions in `app/(app)/admin/leagues/actions.ts` fetch their own API routes (e.g. for the admin Sync button). The action does `requireAdmin()` (which works because it has access to `next/headers`), but the inner `fetch` does NOT automatically forward the user's session cookies. **You must add `"Cookie": await getCookieHeader()` to the fetch headers**, where `getCookieHeader()` reads cookies from `next/headers` and formats them as `name1=value1; name2=value2`. Without this, the API route returns 401 NOT_AUTHENTICATED. **This bug has been re-introduced multiple times. The header comment in the file explains why.**

### Authentication pattern

Every authenticated page does:
```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");
```

The `(app)/layout.tsx` renders the navbar with the user but does NOT redirect — the page-level check does. The `/admin` tree is gated by `requireAdmin()` which checks `prisma.user.isAdmin`.

### Soft delete for competitions

`Competition.deletedAt` (set by `DELETE /api/v1/admin/competitions/[id]`). All `findMany` queries MUST filter `where: { deletedAt: null }`. The migration added this column; existing rows are `null` (active).

---

## Settlement flow (the core business logic)

When a match transitions to FINISHED (detected by the cron or admin update):

1. `lib/services/auto-settle.ts` calls `trySettle()` for each market type
2. **EXACT_SCORE** is auto-settled with the final score
3. **HALF_SCORING** and **IN_GAME_PENALTY** are **disabled** (Phase 10.9) — they emit warnings but don't settle
4. `lib/services/settle-market.ts` does the actual settle, wrapped in `prisma.$transaction` with retry-on-failure
5. The settle function **groups bets by their `pointsAwarded` value** and issues chunked `updateMany` calls (100 IDs per call) for performance
6. On failure: the retry loop (backoff [1000, 1500, 3000]ms) catches transient Prisma errors

The "always 10" dashboard algorithm: each group shows 3 settled + 7 unsettled = 10 matches (settled first, then unsettled by kickoff time).

## Live polling

`/api/v1/matches/[id]/refresh` (per-match) is **user-driven** — when a user views a match card, the component polls this endpoint on a 30-120s adaptive cadence. The server:
1. Checks the 5-min per-match `scoreLastSyncedAt` guard
2. If stale: hits football-data for that one match, updates the row, returns the score
3. Returns `nextRefreshMs` for the client to schedule the next poll

The poll triggers for `status === "GOING" AND kickoffTime <= now`. Pre-kickoff and post-FINISHED matches don't poll.

The **1-hour cron** handles all the bulk sync: new matches, status transitions, settled games. The per-match polling is for live scores during a game.

---

## Scoring system

`lib/scoring/default-config.ts` defines the `ScoringConfig` type with 7 stages: `GROUP_STAGE, ROUND_OF_16, QUARTER_FINAL, SEMI_FINAL, FINAL, THIRD_PLACE, OUTRIGHT`. Each stage has 6 active scoring fields (exactScorePoints, drawExactScorePoints, drawWrongScorePoints, rightWinnerRightDiffPoints, rightWinnerOnlyPoints, missPoints).

`mapStage` (in `lib/services/stage-mapper.ts`) normalizes football-data's 20+ stage enum values to these 7 keys. The 2024-25 Champions League uses `LEAGUE_STAGE` (new format) — that maps to `GROUP_STAGE`.

`Competition.details.endDateWithGrace` is the 7-day grace period after a tournament ends (`endDate + 7 days`). `classifyGroupArchive` (in `lib/services/groups.ts`) reads this for the "active/archived" decision.

---

## Currently in-flight (recent work)

The session is in the middle of multi-round work. Some things already in the codebase that a new agent should know about:

- **Retry-on-failure** for `settleMarket` (backoff: 1000ms, 1500ms, 3000ms; only retries on transient Prisma error codes P1001/P1002/P1008/P2034)
- **Chunked + grouped `updateMany`** in the settle loop (groups bets by `pointsAwarded` value, chunks at 100 IDs per call)
- **JSONB `details` columns** on all models with rich metadata from football-data: area, code, type, emblem, plan, currentSeason, availableSeasons, lastUpdated, isActive, endDateWithGrace, scoringOverridesByStage
- **Live preview scoring** in `lib/services/score-preview.ts` (pure function `computeLiveScore` for client-side preview of "what would I get if the game ended now")
- **Tournament-level scoring overrides** at `Competition.details.scoringOverridesByStage` (UI in the Edit Competition modal)
- **Match-level scoring overrides** at `Match.details.scoringOverride` (per-match, more granular than tournament-level)
- **Group rename/leave** (creator-only rename, anyone can leave, empty group auto-deletes with cascade to UserBet)
- **Group creator** tracked in `Group.details.createdBy` (JSONB, not a typed column — backward compatible)
- **Settings page** at `/settings` with nickname + emoji (the emoji uses a curated `EmojiPicker` component, not a text input)
- **Always-10 dashboard** algorithm (3 settled + 7 unsettled per group)

---

## What is NOT in scope / explicitly out

- **Per-bet points editing** by admin (out of scope per principal — settled bets keep their `pointsAwarded`)
- **Re-settle after config change** (out of scope — config changes are forward-looking only)
- **HALF_SCORING and IN_GAME_PENALTY auto-settle** (disabled in Phase 10.9, emit warnings only)
- **Hard deletes** — all deletes are soft (e.g. `Competition.deletedAt`)
- **Email change / password change / 2FA / avatar upload** in the settings page (just nickname + emoji)
- **Real-time websocket / SSE** for live score updates (polling is good enough for the principal's needs)

---

## How to run

```bash
npm install                    # install
npx prisma migrate dev         # apply schema to dev DB
npx prisma generate            # regenerate client
npm run dev                    # start dev server (http://localhost:3000)
npx vitest run                 # run all tests
npx tsc --noEmit               # type-check (2 pre-existing errors in seed.spec.ts are OK)
npm run admin:promote -- user@email.com   # promote a user to admin
```

Env vars required (see `.env.example`):
- `DATABASE_URL` (transaction-mode pooler, port 6543)
- `DIRECT_URL` (direct, port 5432)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `APP_URL` (used by server actions to fetch their own API routes)
- `CRON_SECRET` (required in production for the cron)
- `FOOTBALL_DATA_TOKEN` (free tier at football-data.org)

---

## Further reading

- `README.md` — quick start, features overview
- `DEPLOY.md` — full deployment guide for Vercel + Supabase + GitHub Actions cron
- `DESIGN.md` — design system: tokens, typography, components, accessibility
- `NEXTJS16_NOTES.md` — why we pinned to Next.js 15.5.19 (the backport) and the upgrade checklist
- `~/.opencode/sessions/` — Mrbrain's session artifacts (isc-*.md, execute-*.md, handoff-*.md, audit-*.md, calibration-notes.md) if a session is in progress

---

## Tips for new agents

1. **Read this file first**, then `README.md`, then `DEPLOY.md` and `DESIGN.md` for context.
2. **Before adding new typed columns** to the Prisma schema, consider whether JSONB `details` would suffice (it usually does, and is backward compatible).
3. **Before adding new API routes**, check if a server action would work instead (UI forms → server action; external curl → API route).
4. **Before fixing a "stale" cookie/forwarding/auth bug**, check the recent session artifacts in `~/.opencode/sessions/` — Mrbrain may have already documented the fix and it might have been lost in a commit.
5. **Tests**: every new service function gets a `.test.ts` next to it. Mock `@/lib/prisma` with `vi.hoisted` + `vi.mock`. Mock `@/lib/supabase/server` similarly. Use `vi.stubGlobal("fetch", ...)` for HTTP calls.
6. **UI**: use the design system tokens (`bg-card`, `text-foreground`, `pitch-card`, `neon-button`, `micro-tag`) — no hex, no raw oklch in components.
7. **When in doubt**, ask the principal — they're product-driven, not engineering-driven, and prefer working features over premature engineering.
