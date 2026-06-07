# predicty — Step-by-Step Implementation Plan

A living checklist. Each step is atomic enough to be one delegated task, and references the spec section it implements.

**Conventions**
- `[ ]` = not started · `[~]` = in progress · `[x]` = done · `[!]` = blocked
- Each step lists: **Goal**, **Files**, **Spec ref**, **Acceptance**.
- We do not move to the next step until the current one is `[x]`.
- Before any code in a phase, **read `frontend/node_modules/next/dist/docs/`** (per `frontend/AGENTS.md` — Next.js 16 has breaking changes).

---

## 0. Architectural Decisions (locked-in defaults — override before Step 0.1 if you disagree)

| Decision | Choice | Rationale |
|---|---|---|
| Backend topology | **Consolidate into Next.js 16** | One deploy, one repo, idiomatic for Supabase. The Express stub at `backend/` is dead weight (24-byte `index.ts`) and will be deleted. |
| API style | **Next.js Route Handlers** at `/api/v1/*` | Matches the spec's path scheme exactly. Server Actions for forms. |
| Database | **Supabase Postgres** (local via `supabase` CLI, then hosted) | Spec says "Supabase or Neon". Supabase gives us Auth + RLS + storage in one. |
| ORM | **Prisma** | Spec is written in Prisma; matches verbatim. |
| Auth | **Supabase magic-link** via `@supabase/ssr` | Spec says passwordless email magic links. |
| Admin role | **`app_metadata.role = "admin"`** on the Supabase user | Checked in server-side guards; never trust client. |
| Realtime | **None in v1** | Polling on tab focus + manual refresh. Add Supabase Realtime later if needed. |
| Validation | **Zod** for request/response schemas | Reused on client + server. |
| Testing | **Vitest** (unit) + **Playwright** (E2E) | Defer E2E until Phase 4. |
| Deployment | **Vercel** for the app | Supabase project is the only other deployable. |
| Repo structure | **Flat** — Next.js app at repo root | Move `frontend/*` → repo root. Single app, no monorepo needed yet. |

> **Override before starting:** tell me to flip any of these and I'll revise.

---

## 0.1. Repo Target State (end of Phase 0)

```
predicty/
├── app/                        # Next.js App Router (was frontend/app)
│   ├── (marketing)/page.tsx    # public landing
│   ├── (auth)/login/page.tsx
│   ├── (auth)/auth/callback/route.ts
│   ├── (app)/dashboard/page.tsx
│   ├── (app)/onboarding/page.tsx
│   ├── (app)/groups/[groupId]/page.tsx
│   ├── (app)/join/[inviteCode]/page.tsx
│   ├── (app)/admin/page.tsx
│   ├── api/v1/...              # route handlers
│   ├── layout.tsx
│   └── globals.css             # matches DESIGN.md
├── components/
│   ├── ui/                     # shadcn-style primitives
│   ├── auth/
│   ├── groups/
│   ├── matches/
│   ├── leaderboard/
│   └── admin/
├── lib/
│   ├── supabase/               # server.ts, client.ts, middleware.ts
│   ├── prisma.ts
│   ├── auth.ts                 # session helpers, role checks
│   ├── time.ts                 # UTC + 5-min lockdown helpers
│   ├── invite.ts               # invite-code generation
│   ├── scoring/                # Strategy Factory
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── exact-score.ts
│   │   └── outright-text.ts
│   └── validation/             # Zod schemas
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── supabase/
│   ├── migrations/             # RLS policies
│   └── seed.sql
├── tests/
│   ├── unit/
│   └── e2e/
├── public/
├── steps.md                    # this file
├── package.json
├── next.config.ts
├── tailwind.config / postcss.config  # Tailwind v4 inline
├── tsconfig.json
├── .env.example
├── .env.local                  # gitignored
└── README.md
```

---

## Phase 0 — Project Foundation

- [x] **0.1 Move `frontend/*` to repo root** ✅
  - Done 2026-06-07. `predicty/` is now the Next.js app directly. `frontend/` and `backend/` removed. `.git` re-initialized. `CLAUDE.md` (=`@AGENTS.md` pointer) kept.

- [x] **0.2 Git branch isolation + .gitignore polish** ✅
  - Done 2026-06-07. On `feat/init-foundation`. `.gitignore` extended for supabase/playwright/prisma local artifacts. Committed as `01309f8`.

- [x] **0.3 Audit + revert to Next.js 15 stable backport** ✅
  - Done 2026-06-07. Next.js reverted from 16.2.7 → **15.5.19** (`backport` tag). React bumped 19.2.4 → **19.2.7** (latest stable). `AGENTS.md` warning replaced. `NEXTJS16_NOTES.md` written documenting the audit and the reversion decision.
  - Outcome: Next.js 15.5.19 is the version my training knows — no breaking changes expected.

- [x] **0.4 Add core dependencies** ✅
  - Done 2026-06-07. `@supabase/supabase-js ^2.107.0`, `@supabase/ssr ^0.10.3`, `@prisma/client ^7.8.0`, `zod ^4.4.3`, `nanoid ^5.1.11` in deps. `prisma ^7.8.0`, `vitest ^4.1.8`, `@vitest/coverage-v8 ^4.1.8`, `tsx ^4.22.4` in devDeps. Next.js pinned to 15.5.19, React pinned to 19.2.7 (reverted from 16/19.2.4 in 0.3).

- [x] **0.5 Apply the design system in `globals.css` and `layout.tsx`** ✅
  - Done 2026-06-07. `app/globals.css` (209 lines): full oklch token set for light+dark, @theme inline bridge, 6 utility classes, keyframes. `app/layout.tsx`: Fraunces/IBM Plex Sans/IBM Plex Mono instead of Geist. `app/page.tsx`: war-room marketing landing with planner-bg, glass-panel, command-strip CTA.
  - **Note:** DESIGN.md was lost during the folder move and had to be recovered. Double-check file presence after folder operations.
  - Mrsreview: **PASS** — all 9 ISC criteria verified.

- [ ] **0.6 Provision Supabase locally**
  - `npx supabase init` → `npx supabase start` (Docker required).
  - Files: `supabase/config.toml`, `supabase/migrations/`.
  - Acceptance: `supabase status` reports API URL + anon key + service-role key.

- [ ] **0.7 Set up env files**
  - Files: `.env.example`, `.env.local`, `.gitignore` entry.
  - Vars: `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `INVITE_COOKIE_NAME`, `LOCKDOWN_MINUTES=5`.
  - Acceptance: app boots, no missing-var warnings.

- [ ] **0.8 Initialize Prisma**
  - `npx prisma init --datasource-provider postgresql`.
  - Files: `prisma/schema.prisma` (copy from spec verbatim as the starting point), `.env` link to `DATABASE_URL`.
  - Acceptance: `npx prisma validate` succeeds.

- [ ] **0.9 Apply the initial migration**
  - `npx prisma migrate dev --name init`.
  - Files: `prisma/migrations/<timestamp>_init/migration.sql`, `prisma/migrations/migration_lock.toml`.
  - Acceptance: `supabase db reset && npx prisma migrate deploy` works cleanly.

- [ ] **0.10 Generate Prisma client + singleton**
  - Files: `lib/prisma.ts` (singleton with hot-reload guard).
  - Acceptance: importing `prisma` from `@/lib/prisma` in a Route Handler returns a working client.

- [ ] **0.11 Supabase client helpers (server / client / middleware)**
  - Files: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`. Follow the official `@supabase/ssr` recipe adapted for App Router cookies.
  - Acceptance: a server component can read the current user via `await getUser()`.

- [ ] **0.12 Middleware: refresh session + route protection**
  - Files: `middleware.ts` at repo root.
  - Logic: refresh Supabase session on every request; redirect unauthenticated users from `/(app)/*` to `/login`; redirect non-onboarded users to `/onboarding`; redirect non-admins from `/admin` to `/dashboard`.
  - Acceptance: visit `/dashboard` while logged out → 302 to `/login`.

- [ ] **0.13 Set up Vitest**
  - Files: `vitest.config.ts`, `tests/unit/setup.ts`, sample `tests/unit/smoke.test.ts`.
  - Acceptance: `npm test` runs and passes.

- [ ] **0.14 Lockstep script for `supabase + prisma`**
  - `package.json` script: `db:reset = supabase db reset && prisma migrate deploy && prisma db seed`.
  - Acceptance: from a clean clone, one command takes you to a seeded DB.

---

## Phase 1 — Hydration & Admin Sync (spec §1.1, §3.3, §5 Phase 1)

- [ ] **1.1 Refine Prisma schema**
  - Add: `User.id` aligns with `auth.users.id` (use the same UUID from Supabase Auth), `Match.status` enum (`SCHEDULED | FINISHED`), `BetMarket.options Json?` for proposition markets, indexes on `Match.competitionId`, `Match.kickoffTime`, `UserBet.groupId`, `UserBet.marketId`.
  - Files: `prisma/schema.prisma`.
  - Acceptance: `prisma migrate dev --name refine_schema` clean.

- [ ] **1.2 Mock competition JSON**
  - Files: `prisma/seed/fixtures/wc-2026-group-stage.json` (4–6 matches, all UTC kickoff times, includes a `apiMatchId`).
  - Acceptance: file validates against a Zod schema in `lib/validation/competition.ts`.

- [ ] **1.3 Default `scoringConfig` factory**
  - Files: `lib/scoring/default-config.ts`.
  - Shape: per-stage `{ exactScorePoints, outcomePoints, bothTeamsToScoreBonus, staticPoints }`. Sensible defaults (e.g. group: 5/2/1, R16: 8/3/1, QF: 12/4/1, SF: 18/6/1, F: 25/8/1).
  - Acceptance: unit-tested; `JSON.stringify` round-trips.

- [ ] **1.4 Invite-code generator**
  - Files: `lib/invite.ts` → `generateInviteCode(): string` (10-char `nanoid` url-safe, no ambiguous chars).
  - Acceptance: unit test for uniqueness over 100k calls (no collisions).

- [ ] **1.5 Zod request schemas**
  - Files: `lib/validation/admin.ts` (`CompetitionSyncInput`), `lib/validation/group.ts` (`CreateGroupInput`).
  - Acceptance: rejects malformed payloads in unit test.

- [ ] **1.6 Admin guard helper**
  - Files: `lib/auth/guards.ts` → `requireAdmin()` for use in Route Handlers and Server Components. Reads `app_metadata.role` from Supabase session.
  - Acceptance: unit test mocks session; non-admin throws `403`.

- [ ] **1.7 `/api/v1/admin/competition/sync` — idempotent upsert**
  - Method: `POST`. Body: `CompetitionSyncInput` (competition + matches[]). Uses Prisma `upsert` keyed on `Match.apiMatchId` (compound uniqueness: `(competitionId, apiMatchId)` so the same external id can exist across competitions). Inserts new competitions, upserts matches, **never deletes** matches (so existing `UserBet` rows stay valid even if a match is removed upstream).
  - Files: `app/api/v1/admin/competition/sync/route.ts`, `lib/services/competition-sync.ts`.
  - Acceptance: posting the mock JSON twice produces exactly N match rows, not 2N. Verified by integration test that counts rows before/after.

- [ ] **1.8 Promote the first admin**
  - Files: `supabase/seed.sql` (or a one-off script `scripts/promote-admin.ts`) that sets `auth.users.app_metadata = { "role": "admin" }` for a hard-coded dev email read from `DEV_ADMIN_EMAIL`.
  - Acceptance: logging in as that email passes `requireAdmin()`.

- [ ] **1.9 Admin shell layout**
  - Files: `app/(app)/admin/layout.tsx` (server-side `requireAdmin`), `app/(app)/admin/page.tsx` (admin home with two cards: Hydration, Settlement).
  - Acceptance: non-admin visiting `/admin` is redirected to `/dashboard`.

- [ ] **1.10 Data Hydration Terminal UI**
  - Files: `app/(app)/admin/hydration/page.tsx` + `components/admin/HydrationForm.tsx`.
  - UX: textarea (paste JSON) + file input + "Sync" button. Uses a Server Action that calls the sync service. Shows a results panel: created/updated/skipped counts, list of any errors per match.
  - Acceptance: pasting the mock JSON and clicking Sync shows "12 updated, 0 created" on second run, no errors.

- [ ] **1.11 Integration test for idempotency**
  - Files: `tests/integration/admin-sync.test.ts` (uses a test DB or transaction rollback).
  - Acceptance: red → green as the sync logic lands.

---

## Phase 2 — Auth, Profiles & Group Creation (spec §1.3, §4.1, §5 Phase 2)

- [ ] **2.1 Marketing landing page**
  - Files: `app/(marketing)/page.tsx`. Hero with brand, "Sign Up / Log In" button → `/login`.
  - Acceptance: unauthenticated visit renders the landing.

- [ ] **2.2 `/login` page — magic link**
  - Files: `app/(auth)/login/page.tsx`. Form posts to a Server Action that calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: APP_URL + '/auth/callback' } })`.
  - Acceptance: submitting a valid email shows "Check your inbox"; invalid email shows validation error.

- [ ] **2.3 Auth callback handler**
  - Files: `app/(auth)/auth/callback/route.ts` (or Server Component page). Exchanges the auth code for a session, then redirects to `/onboarding` (first time) or `/dashboard` (returning).
  - Acceptance: clicking the magic link lands the user on the right screen.

- [ ] **2.4 Onboarding wizard**
  - Files: `app/(app)/onboarding/page.tsx`, `components/auth/OnboardingForm.tsx`.
  - UX: nickname (unique check via API) + emoji grid (preset set: ⚽🍕⚡🐉🎯🦄🔥💎🌊🍿).
  - Server Action: `completeOnboarding({ nickname, emoji })` writes to `User` (which is auto-created in a DB trigger on first auth — see 2.5).
  - Acceptance: a fresh auth user cannot reach `/dashboard` until onboarding is done; refreshing `/onboarding` after submit goes to `/dashboard`.

- [ ] **2.5 Auto-provision `User` row on first auth**
  - Files: `supabase/migrations/<ts>_handle_new_user.sql` — Postgres function + trigger on `auth.users` insert that inserts a corresponding `public.User` row.
  - Acceptance: first login creates exactly one `User`; second login does not duplicate.

- [ ] **2.6 Dashboard empty state**
  - Files: `app/(app)/dashboard/page.tsx`. Server component fetches the user's `GroupMember` rows. If empty → "You aren't in any pools yet!" + "Create a Tournament Pool" button. If non-empty → list of group cards.
  - Acceptance: matches Journey 1 step 4.

- [ ] **2.7 Group creation form**
  - Files: `components/groups/CreateGroupDialog.tsx` (modal), `app/(app)/dashboard/actions.ts` (Server Action `createGroup`).
  - Fields: `name`, `competitionId` (dropdown of existing competitions). Server Action validates, generates `inviteCode`, writes `Group` with `scoringConfig` from default factory.
  - Acceptance: refreshing dashboard shows the new group card.

- [ ] **2.8 Group dashboard shell**
  - Files: `app/(app)/groups/[groupId]/page.tsx`, `app/(app)/groups/[groupId]/layout.tsx`. Tabs: Matches · Leaderboard · Members. Top banner: invite link copy button.
  - Acceptance: navigating to `/groups/<id>` renders the shell; non-members are denied (see 2.9).

- [ ] **2.9 Group membership guard**
  - Files: `lib/auth/guards.ts` adds `requireGroupMember(groupId)`. Used in the group layout and in the feed/markets/save APIs.
  - Acceptance: a logged-in user who is not a member of `groupId` is redirected to `/dashboard` (or gets `403` from API).

- [ ] **2.10 Invite link copy UI**
  - Files: `components/groups/InviteBanner.tsx`. Generates `${APP_URL}/join/${group.inviteCode}` and uses `navigator.clipboard.writeText`.
  - Acceptance: clicking "Copy" puts the exact URL in the clipboard; toast confirms.

---

## Phase 3 — Deep-Link Invite Interceptor (spec §1.3 invite lifecycle, §4.2, §5 Phase 3)

- [ ] **3.1 `/join/[inviteCode]` route — server-side bootstrap**
  - Files: `app/(app)/join/[inviteCode]/page.tsx`. Server component: look up group by `inviteCode`; pass `groupName` to client component; if not found, show 404.
  - Acceptance: visiting `/join/wc-abc123` with a real code shows the "You've been invited to join X" screen.

- [ ] **3.2 Invite cache (httpOnly cookie)**
  - Files: `lib/invite-cookie.ts` with `setInviteCookie(code)`, `getInviteCookie()`, `clearInviteCookie()`. Cookie name from `INVITE_COOKIE_NAME`; `httpOnly`, `sameSite=lax`, `secure` in prod, 24h expiry.
  - Acceptance: setting the cookie survives reloads; cleared on consume.

- [ ] **3.3 Auth intercept decision**
  - In `app/(app)/join/[inviteCode]/page.tsx`: if session present → call `joinGroup` Server Action immediately → clear cookie → redirect to `/groups/<id>`. If not → set cookie → redirect to `/login?invited=1`.
  - Acceptance: matches Journey 2.

- [ ] **3.4 `/login` honours `?invited=1`**
  - Files: `app/(auth)/login/page.tsx`. Renders the "You've been invited to join X" prompt using `groupName` looked up from the cookie. After callback, post-onboarding resumes the invite.
  - Acceptance: journey 2 flow works end-to-end with cookie as the carrier.

- [ ] **3.5 `joinGroup` Server Action / API**
  - Files: `app/api/v1/groups/join/route.ts` and `lib/services/join-group.ts`. Looks up group, checks duplicate via `GroupMember @@unique([userId, groupId])`, creates `GroupMember` row.
  - Acceptance: rejoining the same group is a no-op (returns existing group), not an error.

- [ ] **3.6 Post-onboarding invite resolution**
  - In the onboarding Server Action: after `completeOnboarding` writes the user, if `inviteCode` cookie exists, call `joinGroup` and clear the cookie before redirecting.
  - Acceptance: new user invited from WhatsApp completes onboarding and lands in the group dashboard in one flow.

- [ ] **3.7 Integration test: invite lifecycle**
  - Files: `tests/integration/invite-flow.test.ts`. Simulates: anonymous visit → cookie set → "login" → onboarding → join → cookie cleared.
  - Acceptance: passes against a real Supabase test instance.

---

## Phase 4 — Betting Screens & Server Security Masks (spec §1.2, §3.1, §3.2, §4.3, §5 Phase 4)

- [ ] **4.1 Time helpers (single source of truth)**
  - Files: `lib/time.ts` → `LOCKDOWN_MS`, `isLocked(match: { kickoffTime: Date }): boolean`, `maskForOthers(currentUserId, ownerId, match)`.
  - Acceptance: unit tests cover the exact T-5min boundary in both directions.

- [ ] **4.2 Feed query with anti-snooping mask**
  - Files: `lib/services/group-feed.ts` → `getGroupFeed({ groupId, viewerId })`. Returns matches + markets + viewer's own `UserBet`s; foreign `UserBet`s are masked to `"🔒"` when `isLocked(match)`. When unlocked (or settled), foreign bets are visible.
  - Files: `app/api/v1/groups/[groupId]/feed/route.ts` (GET).
  - Acceptance: integration test — viewer A loads feed 1h before kickoff: sees own bet value, sees `"🔒"` for B and C. At T-5min, re-fetch shows real values.

- [ ] **4.3 Matches tab UI (mobile-first)**
  - Files: `app/(app)/groups/[groupId]/matches/page.tsx` (Server Component), `components/matches/MatchList.tsx`, `components/matches/MatchCard.tsx`. Renders matches grouped by `kickoffTime` in viewer's IANA tz. Each card shows teams, kickoff, market questions, and per-member slot (own = editable, others = `🔒` if locked, else the value).
  - Acceptance: journey 3 step 1 renders correctly on a mobile viewport (≤ 375px).

- [ ] **4.4 Prediction form**
  - Files: `components/matches/PredictionForm.tsx`. For `EXACT_SCORE`: two number inputs (home, away). For `OUTRIGHT_TEXT`: single text input. For `PROPOSITION_CHOICE`: select from `market.options`. Submits to the save endpoint.
  - UX rules: form is disabled + reason text shown if `isLocked`; countdown timer shows time-to-lock.
  - Acceptance: countdown is accurate; saving reflects in the UI optimistically.

- [ ] **4.5 `/api/v1/bets/save` — server-time lockdown**
  - Files: `app/api/v1/bets/save/route.ts`, `lib/services/save-bet.ts`. POST body: `{ groupId, marketId, predictedValue }`. Server steps:
    1. Auth check.
    2. Membership check for `groupId`.
    3. Look up `market.match` (or null for outright). If `match && isLocked(match)` → `403 { error: "BETTING_LOCKED" }`.
    4. Upsert `UserBet` on the `@@unique([userId, groupId, marketId])` key.
    5. Return the updated row.
  - Acceptance: integration test using a frozen clock — submit at T-6min succeeds, T-4min returns 403, T-3min returns 403.

- [ ] **4.6 Edit + delete within window**
  - Files: `app/api/v1/bets/[betId]/route.ts` (PATCH/DELETE) re-runs the lockdown check. Or simpler: PATCH/DELETE on `/bets/save` semantics.
  - Acceptance: PATCH and DELETE both blocked after lock.

- [ ] **4.7 Client-side time source note**
  - The lock UI uses **server-provided** `kickoffTime` and a server-synced `serverNow` from the feed response — never the device clock — to prevent the "I changed my system clock" exploit from the spec. (Spec §3.1 "ignoring any client-side time sync variables".)
  - Acceptance: with a device clock set to 2030, the UI still shows the correct countdown derived from `serverNow`.

- [ ] **4.8 Unit tests for `isLocked` boundary**
  - Files: `tests/unit/time.test.ts`. Table-driven: `{ now, kickoff, expected }` covering T-10m, T-5m, T-4m59s, T-5m00s, T+0, T+10m.

---

## Phase 5 — Scoring & Leaderboards (spec §1.5, §3.4, §4.3, §5 Phase 5)

- [ ] **5.1 Strategy interface + registry**
  - Files: `lib/scoring/types.ts` (`ScoringStrategy { supports(market): boolean; score(input): { points, breakdown } }`), `lib/scoring/index.ts` (`getStrategy(marketType)`).
  - Acceptance: registry returns the right strategy for `EXACT_SCORE`, `OUTRIGHT_TEXT`, `PROPOSITION_CHOICE`; throws for unknown.

- [ ] **5.2 `EXACT_SCORE` strategy**
  - Files: `lib/scoring/exact-score.ts`. Implements the three rules from spec §3.4: exact match, outcome match, BTTS bonus. Reads stage config from `group.scoringConfig[match.stage]`.
  - Acceptance: unit tests for all three rules + a BTTS stack case (exact + BTTS, outcome + BTTS, exact only, outcome only, miss).

- [ ] **5.3 `OUTRIGHT_TEXT` strategy**
  - Files: `lib/scoring/outright-text.ts`. Normalizes both sides (`toLowerCase().trim()`), exact equality grants `staticPoints`.
  - Acceptance: unit test covers case + whitespace normalization.

- [ ] **5.4 `PROPOSITION_CHOICE` strategy (placeholder)**
  - Files: `lib/scoring/proposition-choice.ts` — returns `0` for now with a TODO + interface contract. So adding a new market type later is a one-file change.
  - Acceptance: returns 0; logs unsupported warning.

- [ ] **5.5 Settlement service**
  - Files: `lib/services/settle-market.ts`. On settle:
    1. Set `BetMarket.correctAnswer`, `BetMarket.isSettled = true`.
    2. If market has a `match`, set `Match.status = FINISHED`.
    3. Fetch all `UserBet` rows for the market across **all groups in the competition**.
    4. For each row, look up the owning group's `scoringConfig` and strategy, compute points, persist (we'll add `UserBet.pointsAwarded Int?` in the schema migration).
    5. Return summary `{ scoredRows: N, byGroup: {...} }`.
  - Files: `app/api/v1/admin/markets/settle/route.ts`.
  - Acceptance: settling a market scores every group's users in one transaction.

- [ ] **5.6 Schema addition: `UserBet.pointsAwarded`**
  - Files: `prisma/schema.prisma` → migration `add_points_awarded`. Nullable `Int?` so unsettled bets are `null`.
  - Acceptance: `prisma migrate dev` clean; existing rows have `null`.

- [ ] **5.7 Market Settlement Hub UI**
  - Files: `app/(app)/admin/settlement/page.tsx`, `components/admin/SettlementForm.tsx`. List unsettled markets with match context; input field for `correctAnswer`; "Settle" button. Shows the result summary from the service.
  - Acceptance: settling a market with 2 matches and 4 users shows "8 rows scored" with the per-group breakdown.

- [ ] **5.8 Leaderboard query**
  - Files: `lib/services/leaderboard.ts` → `getGroupLeaderboard(groupId)`. Aggregates `UserBet.pointsAwarded` grouped by user within the group only.
  - Acceptance: integration test — only sums the group's bets; never includes other groups' bets even if the same user is in both.

- [ ] **5.9 Leaderboard view**
  - Files: `app/(app)/groups/[groupId]/leaderboard/page.tsx`, `components/leaderboard/LeaderboardList.tsx`, `components/leaderboard/MemberRow.tsx`. Renders ranked members, total points, settled-bets count.
  - Acceptance: matches Journey 3 step 5.

- [ ] **5.10 Member history view**
  - Files: `app/(app)/groups/[groupId]/members/[userId]/page.tsx`. Shows that member's settled bets, points per market, breakdown of how the points were derived.
  - Acceptance: clicking a member card on the leaderboard opens this view.

- [ ] **5.11 End-to-end scoring test**
  - Files: `tests/integration/scoring.test.ts`. Seed: 1 competition, 1 match, 1 market (`EXACT_SCORE`), 1 group, 2 users with bets [2-1] and [1-1]. Settle with correct `2-1`. Assert: user A got `exactScorePoints` + BTTS, user B got `outcomePoints` (or 0, depending on stage config — make it explicit in the test).
  - Acceptance: passes.

---

## Phase 6 — Hardening, RLS, E2E, Deploy (spec §3.2 tenant isolation)

- [ ] **6.1 Supabase RLS policies**
  - Files: `supabase/migrations/<ts>_rls_policies.sql`.
  - Rules:
    - `User`: row visible only to self.
    - `GroupMember`: read if `userId = auth.uid()`; insert only via service role.
    - `UserBet`: read only if `GroupMember.userId = auth.uid()` for the same `groupId`; insert/update only if group membership exists and the match isn't locked (DB-side function `is_match_locked(match_id)`).
    - `Match`, `Competition`, `BetMarket`: read for all authenticated users; write only via service role.
  - Acceptance: a test user signed in via the anon key can read only their own groups' data; direct DB probes fail.

- [ ] **6.2 Service-role key is server-only**
  - Files: `lib/supabase/server.ts` exports a `getServiceSupabase()` that is imported **only** in `app/api/v1/admin/*` and `lib/services/settlement*`. Add a `tests/unit/no-service-role-leak.test.ts` that greps the repo for `SUPABASE_SERVICE_ROLE_KEY` outside `lib/supabase/server.ts` and `app/api/v1/admin/**`.
  - Acceptance: test passes; the only place the env var is referenced is server-side.

- [ ] **6.3 Vitest coverage gate**
  - `package.json` script `test:ci` runs Vitest with `--coverage` and a 70% line threshold on `lib/`.
  - Acceptance: `lib/scoring`, `lib/time`, `lib/services/*` are ≥ 90%; overall `lib/` ≥ 70%.

- [ ] **6.4 Playwright E2E: the three journeys**
  - Files: `tests/e2e/journey-1-organizer.spec.ts`, `journey-2-invited-friend.spec.ts`, `journey-3-active-competitor.spec.ts`.
  - Each runs against a freshly-reset test Supabase project.
  - Acceptance: all three pass in CI.

- [ ] **6.5 Vercel + Supabase production setup**
  - Files: `vercel.json` (if needed for cron — see 6.6), `README.md` updated with deploy steps.
  - Acceptance: pushing to a branch deploys a preview that connects to the staging Supabase project.

- [ ] **6.6 (Optional) Settlement cron**
  - Files: `app/api/v1/cron/sweep-settlements/route.ts`, Vercel cron config to call it hourly. Auto-settles matches whose `kickoffTime + 3h` is past. Off by default; flip on after manual settlement flow is stable.
  - Acceptance: hourly run settles 0 markets in steady state; settles correct markets after a match finishes and an admin types the score.

---

## Open Questions (resolve before starting Phase 0)

1. **Repo layout** — OK to move `frontend/*` to root? ~~(backend deletion already done)~~ (Step 0.1)
2. **Admin bootstrap** — OK to use `app_metadata.role` on the Supabase user? (Step 1.8) or do you want a `User.isAdmin Boolean` column instead?
3. **Emoji set for onboarding** — the 10-emoji grid in step 2.4 is a placeholder. Want a bigger set, or curated? (Could be a `lib/emoji-presets.ts` file.)
4. **Domain** — `predicty.com`? `kickoffpools.com`? Just for `APP_URL` and the magic-link `emailRedirectTo` for now.
5. **Email provider in dev** — Supabase's built-in SMTP works locally only via `inbucket`; for real magic-link testing we'll need a provider (Resend? Postmark?). Cheap default: Resend + 1 env var.
6. **Multi-competition per group** — spec says 1:1. We enforce it in `createGroup` and at the DB level. Confirm.

---

## Notes

- **Next.js 16** is not the Next.js I know. Re-read `node_modules/next/dist/docs/` at the start of each phase — especially around `cookies()`, `params`/`searchParams` shapes, Server Actions return types, and `middleware.ts` exports.
- **`/api/v1/*`** is intentionally versioned from day one so we can break API shapes without breaking deployed clients.
- **No realtime in v1** keeps the v1 deploy simple. If users complain about leaderboard staleness, Supabase Realtime on `UserBet` and `Match` is a clean bolt-on.
- **Magic numbers** (LOCKDOWN_MINUTES=5, BTTS bonus=1, default point weights) all live in `lib/`. Tweak them in one place.
- **Type safety** is non-negotiable: every API has a Zod request schema + Zod response type. Route Handlers return typed JSON only.
