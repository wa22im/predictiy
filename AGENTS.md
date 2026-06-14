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
- **Prisma 7** with `@prisma/adapter-pg` (TS-source client, NOT the default JS client). See **Database management** below — there are no Prisma migrations.
- **Supabase** (Postgres + email/password auth via `@supabase/ssr`)
- **Tailwind CSS v4** (no `tailwind.config.*`; tokens are bridged in `app/globals.css` via `@theme inline`)
- **Zod** for request validation
- **Lucide React** for icons
- **Vitest** with jsdom + `@testing-library/react` for tests
- **Vercel** for hosting. Cron jobs are driven by **GitHub Actions** (see DEPLOY.md), NOT Vercel Cron (`vercel.json` is now `{}`)

## Data sources

- **football-data.org** — the canonical, auto-synced data source for competitions, matches, and scores. Free tier: 10 req/min. Token in `FOOTBALL_DATA_TOKEN` env var. The hourly cron in `app/api/v1/cron/sync/route.ts` iterates every `Competition` row with `externalSource = "football-data"` and calls `syncFootballDataCompetition(id)` for each. See **Vendor abstraction** below.
- **fixturedownload.com** — the secondary data source, used for tournaments not yet on football-data.org (e.g. FIFA World Cup 2026 group stage). Ingested via the one-shot CLI at `scripts/ingest-fixturedownload.ts` (`npm run ingest:fd`). Not driven by the cron.

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
  init.sql            — Canonical DDL (tables, enums, indexes, triggers) — see **Database management**
  seed/               — Dev seed fixtures
scripts/              — CLI admin/maintenance tools (db-init, db-bootstrap, ingest:fd, admin:promote, etc.)
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

`Competition.deletedAt` (set by `DELETE /api/v1/admin/competitions/[id]`). All `findMany` queries MUST filter `where: { deletedAt: null }`. The column is part of `prisma/init.sql`; existing rows are `null` (active).

### Database management

This project does **not** use Prisma migrations. The schema is managed by a single canonical SQL file:

- `prisma/schema.prisma` — the data model (Prisma's view, used for type-safe client generation against `@prisma/adapter-pg`)
- `prisma/init.sql` — canonical DDL: all tables, enums, indexes, FKs, **and** trigger functions/triggers (including `handle_new_user` and `sync_admin_metadata`). Regenerated via `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`, with the trigger DDL hand-edited in place afterwards.
- `scripts/db-init.ts` — the one-shot recovery script. Drops the `public` schema and re-applies `prisma/init.sql` from scratch. Guarded by `INIT_CONFIRM=yes-i-am-sure`.

The directory `prisma/migrations/` does **not exist**. There is no `_prisma_migrations` table. The system has no P3009/P3018 risk — the schema is whatever `init.sql` says it is, full stop.

#### Workflow

**Ongoing dev (schema changes):**
1. Edit `prisma/schema.prisma` (and update `prisma/init.sql` by hand for the trigger DDL if you touched a trigger function)
2. Run `npm run db:push` to apply the schema to the dev DB
3. Regenerate `prisma/init.sql` via `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/init.sql` and re-apply the hand-edited trigger block

**Fresh-DB recovery (destructive — see "Auth gotcha" below):**
1. `INIT_CONFIRM=yes-i-am-sure npm run db:init` — drops the `public` schema and re-applies `init.sql`
2. `npm run db:seed` (optional, dev fixtures — FIFA World Cup 2026 group stage)
3. Sign up fresh in the browser (creates a new `public.User` row via the `on_auth_user_created` trigger)
4. `npm run admin:promote -- your-email` — re-promote yourself to admin
5. `./scripts/db-bootstrap.sh` is a higher-level wrapper that combines the drop, the init, and the seed in one interactive command (prompts for the literal `wipe-predicty`). Use it when the Supabase project is in an unknown / broken state.

#### Auth gotcha

Supabase sessions are JWT-based and stateless. Wiping the database does **not** invalidate active sessions — the `auth.users` rows in the `auth` schema are untouched, and Supabase's auth middleware will still accept the JWT. After a `db:init` the principal must clear `sb-*` cookies in the browser (DevTools → Application → Cookies) to log out, then sign up again. The `on_auth_user_created` trigger creates a fresh `public.User` row on the next sign-up.

### Vendor abstraction

The architecture supports multiple data sources without vendor lock. The contract is:

**Vendor-agnostic data** (typed columns, common to all sources):
- `Competition.name`, `Competition.endDate`, `Competition.deletedAt`
- `Match.homeTeam`, `Match.awayTeam`, `Match.kickoffTime`, `Match.stage`, `Match.status`, `Match.homeScore`, `Match.awayScore`
- `BetMarket.type`, `BetMarket.title`, `BetMarket.options`, `BetMarket.correctAnswer`

**Vendor-specific data** (JSONB `details` columns, opaque to the app):
- `Competition.details`: area, code, type, emblem, plan, currentSeason, availableSeasons, lastUpdated, isActive, endDateWithGrace, scoringOverridesByStage
- `Match.details`: matchday, group, scoreWinner, scoreDuration, lastUpdated, homeCrest, awayCrest, externalStatus
- `BetMarket.details`: vendor-specific market metadata

**The `Vendor` contract** (the allowed values of `Competition.externalSource`):
- `"football-data"` — data sourced from football-data.org (the canonical pipeline; the cron calls `syncFootballDataCompetition`)
- `"fixturedownload"` — data sourced from fixturedownload.com (one-shot CLI: `npm run ingest:fd`)
- `null` (a.k.a. `"manual"`) — data entered manually via the JSON Hydration Terminal or via custom tournaments

`Competition.externalSource` is a plain nullable text column today (not a Postgres enum), but the three values above are the **only** valid inputs. Validation is enforced at the API boundary in `lib/validation/admin.ts` (Zod) and at the cron in `app/api/v1/cron/sync/route.ts` (defensive `where` clause). The `api-football.com` pipeline is **dead** and is not a valid `Vendor` value.

### The vendor adapter registry

`lib/services/vendors/` is the registry. It exports:
- `VendorAdapter` interface — the contract every vendor implements (`fetchCompetition`, `fetchMatches`, `fetchMatch`)
- `Vendor` type — `"football-data" | "fixturedownload" | "manual"`
- `VENDORS` constant — the list of auto-syncable vendors
- `getVendorAdapter(vendor)` — looks up the adapter for a given vendor

Each vendor has its own adapter file in `lib/services/vendors/<vendor>.ts` (e.g., `football-data.ts`). The adapter is a thin mapping layer that wraps the vendor's API client and exposes the `VendorAdapter` interface. The actual data fetching and writing happens in the existing service files (`sync-football-data-competition.ts`, `apply-football-data-matches.ts`, etc.).

### Adding a new vendor

A 4-step process:
1. Implement the `VendorAdapter` interface in `lib/services/vendors/<vendor>.ts` (a thin mapping layer that returns `CompetitionInput` / `MatchInput`).
2. Register the adapter in `lib/services/vendors/index.ts` (add to `REGISTRY`) and add the vendor name to the `VENDORS` array.
3. Add a `case` to the `syncByVendor` switch in `app/api/v1/cron/sync/route.ts` (dispatching to the per-vendor sync service).
4. Update the Zod schema in `lib/validation/admin.ts` to accept the new `externalSource` value.

No schema change required.

### Why JSONB for vendor-specific data:
- New vendors can be added without schema migrations
- Vendor-specific quirks (e.g., football-data's `currentSeason.winner`, fixturedownload's `matchday`) don't pollute the public schema
- Consumers defensively validate before reading; malformed `details` does not break the app

**Auto-sync rule:** the cron at `app/api/v1/cron/sync/route.ts` iterates over `VENDORS` and dispatches each competition to the right vendor adapter. Competitions with `externalSource = null` (manual / hydration / custom) are **skipped** — they have no source to fetch from. The cron's response shape makes this explicit: it returns a per-vendor report map (`footballData`, `fixturedownload`, etc.) and a legacy `apiFootball: { skipped: true }` block for backward compat.

### Custom tournaments

A **custom tournament** is a `Competition` with `externalSource = null` that contains matches from one or more vendor competitions. Examples:
- A "Best of 2026" tournament with 7 matches from the Champions League, 5 from Spanish La Liga, and 5 from the Premier League
- A user-curated set of matches from different vendors

**Who can manage matches**: Only the **creator** (and future co-editors) of a custom tournament can add/remove matches. The `Competition.details.editors` field stores the list of user IDs who can edit (initially `[createdBy]`). The `POST /api/v1/admin/competitions/[id]/matches` and `DELETE /api/v1/admin/competitions/[id]/matches/[matchId]` endpoints check that the caller is in the `editors` list, returning 403 `NOT_EDITOR` otherwise. The legacy "any authenticated user" rule was relaxed in the public-create-pool / creator-only-edit round — random users used to be able to add/remove matches from tournaments they didn't create, which is no longer the intent.

The page at `/tournaments/[id]/matches` is still accessible to all logged-in users (it lives outside the `(app)/admin` tree), but the action buttons only work for users in the `editors` list. The "Manage matches" link in `/admin/leagues` points to the public URL.

**Future**: the creator will be able to add other users to the `editors` list via a UI. For now, the only editor is the creator. Until that UI lands, the only way to add an editor is to update `Competition.details.editors` directly in the database (admin-only operation).

**Who can create a custom tournament**: Two paths now.

1. **Admin path** — `POST /api/v1/admin/competitions` uses `requireAdmin()`. The new tournament's `details.createdBy` and `details.editors` are seeded with the admin's id, so the admin is the creator + sole editor.
2. **Public path** — any logged-in user can create a custom tournament inline when creating a pool. The endpoint at `POST /api/v1/pools` accepts either an existing `competitionId` or a `newCompetition: { name, endDate }` object. When `newCompetition` is provided, the endpoint creates the custom tournament (with the caller as creator + sole editor) AND a pool tied to it, then returns 201 with `{ id, name, competitionId, competitionName }`. The Create Pool modal at `components/groups/CreatePoolButton.tsx` exposes both options (use existing tournament OR create new custom tournament) as radio buttons.

#### Immutability rules

**`endDate` is required for custom tournaments and immutable after creation.**

- **Required at creation**: Custom tournaments (`externalSource = null`) MUST set `endDate` at creation time. This is enforced at three layers:
  1. **DB CHECK constraint** — `prisma/init.sql` has `CHECK (externalSource IS NOT NULL OR endDate IS NOT NULL)` named `endDate_required_for_custom`. An insert that violates this is rejected by Postgres.
  2. **Zod schema** — `lib/validation/admin.ts`'s `CreateCustomCompetitionInput` makes `endDate: z.string().datetime()` (required, not optional).
  3. **API route** — `app/api/v1/admin/competitions/route.ts` POST handler returns `400 ENDDATE_REQUIRED` when `endDate` is missing or `null` (a clean error code, not the generic Zod "Required" message). Other Zod failures (name length, malformed endDate like `""` or `"not-a-date"`, or a body with multiple issues) fall through to `400 VALIDATION` with the full issues list.
- **Immutable after creation**: The PATCH route at `app/api/v1/admin/competitions/[id]/route.ts` returns 400 `ENDDATE_IMMUTABLE` if the body includes `endDate` (including `endDate: null` — clearing is also rejected) for a target with `externalSource = null`. The `EditCompetitionButton` UI hides the endDate input for custom tournaments and shows the current value (or a "No end date set" message) as read-only text. Other PATCH fields (`name`, `externalLeagueId`, `externalSeason`, `details`) remain mutable for custom tournaments.
- **Vendor tournaments are exempt**: Vendor tournaments (`externalSource = "football-data"` or `"fixturedownload"`) may have a null `endDate`. The CHECK constraint allows null `endDate` whenever `externalSource IS NOT NULL`. The vendor sync path may still rewrite `endDate` as the real tournament's season progresses.

This rule ensures custom tournaments have a stable "ends on" date that doesn't shift underneath the users who joined them. The required-at-creation rule gives admins an explicit commitment moment; the immutable-after-creation rule guarantees the commitment isn't quietly walked back.

#### 1-hour buffer on match additions

`POST /api/v1/admin/competitions/[id]/matches` rejects any `matchId` whose `kickoffTime <= now + 1 hour` (the boundary is strict less-than — a match exactly 1 hour from now is still rejected). Returns `400 MATCH_TOO_CLOSE`. This gives the creator a 1-hour cushion to second-guess their pick before the 5-minute save lockdown kicks in (the save lockdown itself is still 5 minutes before kickoff, see `lib/time.ts`'s `LOCKDOWN_MS`).

The same handler also rejects `matchId`s whose `kickoffTime > competition.endDate` with `400 MATCH_AFTER_ENDDATE`. For vendor tournaments (`externalSource !== null`), the endDate gate is a no-op when `endDate` is null.

The constant lives in `lib/validation/tournament.ts` (`MIN_HOURS_BEFORE_KICKOFF = 1` + `MIN_MS_BEFORE_KICKOFF`). It is imported by:
- `app/api/v1/admin/competitions/[id]/matches/route.ts` — the server-side gate.
- `components/admin/CustomTournamentMatchManager.tsx` — the "Add matches" modal hides matches inside the buffer (and past the endDate) so the user doesn't pick a match the server will reject.

### The `CompetitionMatch` join table

`CompetitionMatch` is a many-to-many join table between `Competition` and `Match`. It allows a `Match` to belong to multiple `Competition` rows (its vendor's parent + N custom tournaments that reference it).

| Column | Type | Notes |
| --- | --- | --- |
| `matchId` | String (FK → Match) | Cascade delete: if the match is deleted, the link is removed |
| `competitionId` | String (FK → Competition) | Cascade delete: if the competition is deleted, all its links are removed |
| `addedAt` | DateTime | When the link was created |

The vendor's own parent association is also a row in `CompetitionMatch` (created by the vendor sync path). The `Match.competitionId` field is kept for backward compat but is now redundant — the `CompetitionMatch` row is the source of truth for "match belongs to competition".

**When a row is created:**
- By the vendor sync path (`apply-football-data-matches.ts`, `ingest-fixturedownload.ts`, `competition-sync.ts`) — links the match to its vendor's parent
- By the JSON Hydration Terminal — links each hydrated match to the hydration target
- By the `POST /api/v1/admin/competitions/[id]/matches` endpoint — when any authenticated user adds a match to a custom tournament

**When a row is deleted:**
- Cascade: when the match or competition is deleted
- By the `DELETE /api/v1/admin/competitions/[id]/matches/[matchId]` endpoint — when an editor removes a match from a custom tournament (only allowed if `kickoffTime > now` and `status !== "FINISHED"`)

### API endpoints

| Method | Path | Body | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/admin/competitions` | `{ name: string, endDate: ISO datetime }` | `201 { id, name, ... }` | Creates a custom tournament with `externalSource = null`. `endDate` is **required** (DB CHECK constraint + Zod schema). Admin-only (`requireAdmin()`). The new row's `details.editors` is seeded with `[caller.id]` (the admin is the creator + sole editor). |
| `POST` | `/api/v1/admin/competitions/[id]/matches` | `{ matchIds: string[] }` (1-100 items) | `{ added: number, requested: number }` | Adds matches to a custom tournament. Uses `createMany` with `skipDuplicates` (idempotent). Auth: `requireAuth()` + the caller must be in `Competition.details.editors` (returns 403 `NOT_EDITOR` otherwise). Each matchId must have `kickoffTime > now + 1 hour` (returns 400 `MATCH_TOO_CLOSE`) and `kickoffTime <= competition.endDate` (returns 400 `MATCH_AFTER_ENDDATE`). |
| `DELETE` | `/api/v1/admin/competitions/[id]/matches/[matchId]` | (none) | `{ removed: boolean }` | Removes a match from a custom tournament. **Only allowed if `kickoffTime > now` and `status !== "FINISHED"`** — returns `400 MATCH_ALREADY_PLAYED` otherwise. Auth: `requireAuth()` + the caller must be in `Competition.details.editors` (returns 403 `NOT_EDITOR` otherwise). |
| `POST` | `/api/v1/pools` | `{ name, competitionId?, newCompetition?: { name, endDate } }` | `201 { id, name, competitionId, competitionName }` | Public Create Pool. Body is XOR(`competitionId`, `newCompetition`). When `newCompetition` is provided, the endpoint creates a custom tournament (with the caller as `createdBy` and the only entry in `editors`) AND a pool tied to it. The caller is added as the first `GroupMember`. Any authenticated user (`requireAuth()`). |

The two custom-tournament manage-matches endpoints stay accessible to all logged-in users at the auth layer, with the editor check now enforcing creator-only edit on top. Server actions that wrap them are in `app/(app)/admin/leagues/actions.ts` with the standard `getCookieHeader()` cookie forwarding; the public-create-pool action `createPoolWithCustomTournamentAction` lives in `app/(app)/dashboard/actions.ts`.

### Settlement across groups

Settlement is **match-level**, not group-level. When a match finishes:
- `settle-market.ts` finds all `UserBet` rows with `marketId` matching the match's markets
- Each `UserBet` row is scored independently based on the user's prediction
- The `UserBet` row has a `groupId` (the group the user was betting in) — the settlement writes `pointsAwarded` per bet

This means: if a user has a bet on Match X in Group A and a separate bet on Match X in Group B (or in a custom tournament), both bets settle independently when Match X finishes. The points are attributed to the user in each group separately. The settlement does not care which competitions Match X belongs to — it only cares about the match itself and the predictions on its markets.

### How matches in custom tournaments get updated

The cron does **not** directly sync matches in custom tournaments (they have no single vendor). Instead, the cron syncs the **vendor's parent** competition. The matches in the custom tournament are the same `Match` rows that are updated by the vendor sync, so they automatically get the latest scores/statuses. The custom tournament's `CompetitionMatch` references stay valid because they point to the same `Match` rows.

Example: Match M is in:
- The Champions League competition (vendor: football-data) — via `Match.competitionId` and a `CompetitionMatch` row
- A "Best of 2026" custom tournament (vendor: null) — via a `CompetitionMatch` row

When the cron runs:
1. It iterates `VENDORS` and finds the Champions League competition (externalSource = "football-data")
2. It dispatches to the football-data adapter and updates Match M's score, status, etc.
3. The "Best of 2026" custom tournament automatically sees the updated Match M (no action needed)

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
npm run db:push                # apply schema to dev DB (uses prisma/schema.prisma)
npm run db:generate            # regenerate the Prisma client
npm run dev                    # start dev server (http://localhost:3000)
npx vitest run                 # run all tests
npx tsc --noEmit               # type-check (2 pre-existing errors in seed.spec.ts are OK)
npm run admin:promote -- user@email.com   # promote a user to admin
```

For a fresh-DB recovery, use `INIT_CONFIRM=yes-i-am-sure npm run db:init` (see **Database management** above).

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
