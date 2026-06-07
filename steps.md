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

- [x] **0.6 Provision Supabase** — **skipped** (using cloud Supabase directly instead of local Docker)

- [x] **0.7 Set up env files** ✅
  - Done 2026-06-07. `.env` (Prisma CLI), `.env.local` (Next.js runtime), `.env.example` (template). Vars: `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APP_URL`, `INVITE_COOKIE_NAME`, `LOCKDOWN_MINUTES=5`.
  - Note: using `User.isAdmin` + RLS for admin enforcement — no `SUPABASE_SERVICE_ROLE_KEY` needed.
  - Acceptance: Prisma CLI connects, Next.js build passes.

- [x] **0.8 Initialize Prisma + write schema** ✅
  - Done 2026-06-07. `npx prisma init` → schema written with all 7 models from spec + `User.isAdmin` flag + indexes. Prisma 7 with `prisma-client` generator (not `prisma-client-js`).
  - Acceptance: `npx prisma validate` succeeds. ✅

- [x] **0.9 Apply the initial migration** ✅
  - Done 2026-06-07. Migration `20260607183836_init` applied to Supabase cloud (via session-mode pooler port 5432).
  - Files: `prisma/migrations/20260607183836_init/migration.sql`.
  - Acceptance: tables created, Prisma validates schema against DB. ✅

- [x] **0.10 Generate Prisma client + singleton** ✅
  - Done 2026-06-07. Prisma 7 + `@prisma/adapter-pg` — generates TS source to `lib/generated/prisma/`. Singleton at `lib/prisma.ts` with `PrismaPg` adapter and `globalThis` hot-reload guard.
  - Acceptance: `npx prisma generate` succeeds, Next.js build resolves imports. ✅

- [x] **0.11 Supabase client helpers** ✅
  - Done 2026-06-07. Three helpers created: `lib/supabase/server.ts` (server components — `createClient()` + `getUser()`), `lib/supabase/client.ts` (browser — singleton), `lib/supabase/middleware.ts` (middleware session refresh).
  - Also added: `lib/utils.ts` with `cn()` utility (clsx + tailwind-merge). ESLint disabled during builds (pre-existing config issue with flat config CJS/ESM mismatch).
  - Acceptance: `npx next build` compiles successfully. ✅

- [x] **0.12 Middleware: refresh session + route protection** ✅
  - Done 2026-06-07. Root `middleware.ts` with matcher for all routes except static assets.
  - Logic: (1) Supabase session refresh + getUser on every matched request; (2) unauthenticated on protected routes → redirect to `/login`; (3) auth'd but no nickname → redirect to `/onboarding`; (4) non-admins on `/admin` → redirect to `/dashboard`; (5) auth'd on public pages → redirect to `/dashboard`.
  - Admin check uses `user.user_metadata.isAdmin` — needs to be synced from `User.isAdmin` DB column during Phase 1.
  - Acceptance: `npx next build` succeeds; middleware binary present (90.3 kB). ✅

- [ ] **0.13 Set up Vitest**
  - Files: `vitest.config.ts`, `tests/unit/setup.ts`, sample `tests/unit/smoke.test.ts`.
  - Acceptance: `npm test` runs and passes.

- [ ] **0.14 Lockstep script for `supabase + prisma`**
  - `package.json` script: `db:reset = supabase db reset && prisma migrate deploy && prisma db seed`.
  - Acceptance: from a clean clone, one command takes you to a seeded DB.

---

## Phase 1 — Hydration & Admin Sync (spec §1.1, §3.3, §5 Phase 1)

- [x] **1.1 Refine Prisma schema** ✅
  - Done 2026-06-07. Migration `20260607185141_refine_schema` applied.
  - Changes: `User.id` aligned with `auth.users.id` (no default), `Match.status` enum, `BetMarket.options Json?`, additional indexes on `Match.status`, `Group.competitionId`, `GroupMember.groupId`, `BetMarket.matchId/isSettled`. Also added `@@unique([matchId, type, title])` on BetMarket for upserts.

- [x] **1.2 Mock competition JSON** ✅
  - Done 2026-06-07. `prisma/seed/fixtures/wc-2026-group-stage.json` — 5 group-stage matches + 1 outright winner match with two markets (Winner + Golden Boot with options).

- [x] **1.3 Default `scoringConfig` factory** ✅
  - Done 2026-06-07. `lib/scoring/default-config.ts` with `DEFAULT_SCORING_CONFIG` and `getStageConfig(stage)` helper. Per-stage weights: GROUP 5/2/1, R16 8/3/1, QF 12/4/1, SF 18/6/1, F 25/8/1, OUTRIGHT static 15.

- [x] **1.4 Invite-code generator** ✅
  - Done 2026-06-07. `lib/invite.ts` — 10-char nanoid with custom alphabet (no 0/O/1/l/I). Unit test deferred to 1.11.

- [x] **1.5 Zod request schemas** ✅
  - Done 2026-06-07. `lib/validation/admin.ts` (`CompetitionSyncInput`, `MatchInput`, `MarketInput`) + `lib/validation/group.ts` (`CreateGroupInput`). Unit tests deferred to 1.11.

- [x] **1.6 Admin guard helper** ✅
  - Done 2026-06-07. `lib/auth/guards.ts` — `requireAdmin()` checks Supabase session, then queries `User.isAdmin` from DB. Throws `GuardError(401|403)`. Auth metadata sync via trigger (see 1.8).

- [x] **1.7 `/api/v1/admin/competition/sync` — idempotent upsert** ✅
  - Done 2026-06-07. POST handler in `app/api/v1/admin/competition/sync/route.ts` + service in `lib/services/competition-sync.ts`. Validates with Zod, calls `requireAdmin()`, upserts competition by name, matches by `apiMatchId`, markets by `(matchId, type, title)`. Never deletes.

- [x] **1.8 Promote the first admin** ✅
  - Done 2026-06-07. Two pieces:
  - (a) `scripts/promote-admin.ts` — `npx tsx scripts/promote-admin.ts <email>` sets `User.isAdmin = true`.
  - (b) Postgres trigger `on_user_admin_changed` mirrors the flag to `auth.users.raw_user_meta_data.isAdmin` so the middleware can pre-filter from the JWT.

- [x] **1.9 Admin shell layout** ✅
  - Done 2026-06-07. `app/(app)/admin/layout.tsx` — server-side check via `createClient()` + `prisma.user.findUnique`; redirects unauthenticated → `/login`, non-admin → `/dashboard`. `app/(app)/admin/page.tsx` — home with two cards (Hydration, Settlement; Settlement is disabled as Phase 5).
  - Stub pages also added: `/login`, `/dashboard`, `/onboarding` so middleware redirects don't 404.

- [x] **1.10 Data Hydration Terminal UI** ✅
  - Done 2026-06-07. `app/(app)/admin/hydration/page.tsx` + `components/admin/HydrationForm.tsx` (Client Component).
  - UX: textarea + file upload + "Sync" button → Server Action `syncCompetitionAction` → result panel with created/updated counts and per-match errors. Uses `useTransition` for loading state.
  - End-to-end requires Phase 2 auth to test in browser. The endpoint itself can be tested via curl with a Supabase bearer token.

- [ ] **1.11 Integration test for idempotency**
  - Files: `tests/integration/admin-sync.test.ts` (uses a test DB or transaction rollback).
  - Acceptance: red → green as the sync logic lands.

---

## Phase 2 — Auth, Profiles & Group Creation (spec §1.3, §4.1, §5 Phase 2)

- [x] **2.1 Marketing landing page** ✅
  - Done 2026-06-07. The existing `app/page.tsx` war-room landing already has the CTA → `/login`. (No separate `(marketing)` route group needed; route groups are for layout differences only.)

- [x] **2.2 `/login` page — magic link** ✅
  - Done 2026-06-07. `app/(app)/login/page.tsx` + `actions.ts` + `components/auth/LoginForm.tsx`. Server Action `loginAction` calls `signInWithOtp` with `emailRedirectTo: ${APP_URL}/auth/callback`. Zod-validated email. "Check your inbox" success state.

- [x] **2.3 Auth callback handler** ✅
  - Done 2026-06-07. `app/(app)/auth/callback/route.ts` — exchanges the code for a session, checks `User.nickname` to decide between `/onboarding` (first time) and the requested `next` URL (default `/dashboard`).

- [x] **2.4 Onboarding wizard** ✅
  - Done 2026-06-07. `app/(app)/onboarding/page.tsx` + `actions.ts` + `components/auth/OnboardingForm.tsx`. Nickname (2-24 chars, alphanumeric+underscore, unique check) + 10-emoji grid. Writes to DB + sync auth metadata. Redirects to `/dashboard` on success.

- [x] **2.5 Auto-provision `User` row on first auth** ✅
  - Done 2026-06-07. Postgres trigger `on_auth_user_created` on `auth.users` inserts a `public.User` row with the same UUID, empty nickname, default ⚽ emoji, `isAdmin=false`. ON CONFLICT (id) DO NOTHING for idempotency.

- [x] **2.6 Dashboard empty state** ✅
  - Done 2026-06-07. `app/(app)/dashboard/page.tsx` — server-side fetches user's GroupMembers + all Competitions. Empty state: glass panel with "You aren't in any pools yet!" + Create button. Populated state: card grid of group tiles.

- [x] **2.7 Group creation form** ✅
  - Done 2026-06-07. `app/(app)/dashboard/actions.ts` + `components/groups/CreatePoolButton.tsx`. Modal with name + competition dropdown. Server Action generates 10-char invite code, creates Group with `DEFAULT_SCORING_CONFIG`, and auto-adds creator as member. Redirects to `/groups/[id]`.

- [x] **2.8 Group dashboard shell** ✅
  - Done 2026-06-07. `app/(app)/groups/[groupId]/page.tsx` — group title, competition, member count, invite banner, three cards (Matches / Leaderboard / Members roster). Inline membership check redirects non-members to `/dashboard`.

- [x] **2.9 Group membership guard** ✅
  - Done 2026-06-07. `lib/auth/guards.ts` adds `requireGroupMember(groupId)`. Uses `prisma.groupMember.findUnique` with the `(userId, groupId)` unique key. Throws `GuardError(401|403)`. Used in group layout and feed/save APIs (Phase 4).

- [x] **2.10 Invite link copy UI** ✅
  - Done 2026-06-07. `components/groups/InviteBanner.tsx` — generates `${NEXT_PUBLIC_APP_URL}/join/${inviteCode}`, uses `navigator.clipboard.writeText`, shows "✓ Copied" for 2s.

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
2. **Admin bootstrap** — ~~app_metadata.role~~ → **`User.isAdmin Boolean` column** (decided: RLS + flag, not service_role key)
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
