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

- [x] **0.14 Lockstep script for db setup** ✅
  - Done 2026-06-07. Seed file at `prisma/seed.ts` (idempotent — uses upserts, reads from the JSON fixture). Seed command configured in `prisma.config.ts → migrations.seed` (Prisma 7 doesn't read it from `package.json`).
  - Scripts added to `package.json`:
    - `db:migrate` — `prisma migrate deploy` (apply pending)
    - `db:reset` — `prisma migrate reset --force` (destructive, dev only)
    - `db:seed` — `prisma db seed`
    - `db:studio` — `prisma studio` (browse data)
    - `db:generate` — `prisma generate` (regenerate client)
    - `admin:promote` — `tsx scripts/promote-admin.ts`
  - Cloud-Supabase note: spec's `supabase db reset` becomes `prisma migrate reset --force`. For non-destructive reapply, use `db:migrate`.

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

- [x] **2.2 `/login` page — email + password** ✅
  - Done 2026-06-07. `app/(app)/login/page.tsx` + `actions.ts` + `components/auth/LoginForm.tsx`. Server Action `loginAction` calls `signInWithPassword`. Zod-validated email + non-empty password. On success, redirects to `/dashboard` (or `/onboarding` if not yet onboarded).
  - Note: original magic-link implementation replaced with email+password on user request. `signInWithOtp` no longer called.

- [x] **2.2.1 `/signup` page — email + password with confirmation** ✅
  - Done 2026-06-07. `app/(app)/signup/page.tsx` + `actions.ts` + `components/auth/SignupForm.tsx`. Form: email, password, confirm-password. Server Action `signupAction` validates match + calls `signUp`. On success, redirect to `/onboarding`. On session=null (email confirmation still enabled), surfaces a clear error pointing at the Supabase dashboard setting.
  - **Prerequisite:** "Confirm email" must be turned off in Supabase → Authentication → Providers → Email.

- [x] **2.3 Auth callback handler** ✅
  - Done 2026-06-07. `app/(app)/auth/callback/route.ts` — exchanges the code for a session, checks `User.nickname` to decide between `/onboarding` (first time) and the requested `next` URL (default `/dashboard`). Kept for future OAuth/email-link use cases.

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

- [x] **3.1 `/join/[inviteCode]` route — server-side bootstrap** ✅
  - Done 2026-06-07. `app/(app)/join/[inviteCode]/page.tsx` — server-side: looks up group by `inviteCode`, 404s if missing, joins immediately if authenticated, else sets cookie + redirects to `/login?invited=1`.

- [x] **3.2 Invite cache (httpOnly cookie)** ✅
  - Done 2026-06-07. `lib/invite-cookie.ts` — `getInviteCookie`, `setInviteCookie(code)`, `clearInviteCookie()`. Cookie name from `INVITE_COOKIE_NAME` (default `predicty_invite`); `httpOnly`, `sameSite=lax`, `secure` in prod, 24h expiry.

- [x] **3.3 Auth intercept decision** ✅
  - Done 2026-06-07. `/join/[inviteCode]` does the auth check: signed in → `joinGroupByInviteCode` + clear cookie + redirect to `/groups/<id>`. Not signed in → set cookie + redirect to `/login?invited=1`.

- [x] **3.4 `/login` and `/signup` honour the invite** ✅
  - Done 2026-06-07. Both pages read the cookie and look up the group name to display the "You've been invited to join X" prompt. The form action consumes the cookie (steps 3.5+3.6) to auto-join after sign-in or sign-up.

- [x] **3.5 `joinGroup` Server Action / API** ✅
  - Done 2026-06-07. `lib/services/join-group.ts` — `joinGroupByInviteCode(userId, code)` uses `prisma.groupMember.upsert` on `@@unique([userId, groupId])` for idempotency. Returns `{ id, name }` or `null`. Both `app/api/v1/groups/join/route.ts` (POST) and the action paths call it.

- [x] **3.6 Post-auth invite resolution** ✅
  - Done 2026-06-07. The cookie is consumed at three points:
    - `loginAction` — after `signInWithPassword` for onboarded existing users
    - `signupAction` — sets `redirectTo: /onboarding` (cookie stays for the onboarding step)
    - `completeOnboardingAction` — after `prisma.user.update` + `supabase.auth.updateUser`, joins the group and clears the cookie
  - All three paths handle the cookie via the same `getInviteCookie` / `clearInviteCookie` helpers.

- [ ] **3.7 Integration test: invite lifecycle** ⏭ deferred
  - File: `tests/integration/invite-flow.test.ts`. Needs Vitest setup (0.13) first.

---

## Phase 4 — Betting Screens & Server Security Masks (spec §1.2, §3.1, §3.2, §4.3, §5 Phase 4)

- [x] **4.1 Time helpers** ✅
  - Done 2026-06-07. `lib/time.ts` exports `LOCKDOWN_MS` (from `LOCKDOWN_MINUTES` env, default 5), `isLocked(match, now?)`, `timeUntilLock(match, now?)`, `formatCountdown(ms)`. Server clock is the source of truth.

- [x] **4.2 Feed query with anti-snooping mask** ✅
  - Done 2026-06-07. `lib/services/group-feed.ts` — `getGroupFeed(groupId, viewerId)`. Returns matches + markets + viewer's own bet + other members' bets. Foreign bets are masked to `"🔒"` when `isLocked` is true. Settled matches (status = `FINISHED`) reveal everything. Response also includes `serverNow` and `lockdownMs` so the UI can render an accurate countdown.

- [x] **4.3 Matches tab UI (mobile-first)** ✅
  - Done 2026-06-07. `app/(app)/groups/[groupId]/matches/page.tsx` (Server Component, server-time feed fetch) + `components/matches/MatchList.tsx` (groups by day in device tz) + `MatchCard.tsx` (teams, kickoff, status, markets).
  - Mobile-first layout, single column, sticky day headers.

- [x] **4.4 Prediction form** ✅
  - Done 2026-06-07. `components/matches/PredictionForm.tsx`. Three modes:
    - `EXACT_SCORE`: two number inputs (home, away), submits as `"X-Y"`
    - `OUTRIGHT_TEXT`: free-form text input
    - `PROPOSITION_CHOICE`: pill-style option picker
  - When `matchLocked`, the form is replaced with a read-only display of the viewer's bet. Countdown via `<Countdown>` component.

- [x] **4.5 `/api/v1/bets/save` — server-time lockdown** ✅
  - Done 2026-06-07. `app/api/v1/bets/save/route.ts` (POST) + `lib/services/save-bet.ts`. Server steps: auth → membership → market lookup → `isLocked` check (403 `BETTING_LOCKED` if past) → value validation by type → upsert on `@@unique([userId, groupId, marketId])`.

- [x] **4.6 Edit + delete within window** ✅
  - Done via upsert in 4.5 — the save endpoint handles both create and update (re-submitting within the window updates the value). No separate PATCH/DELETE needed. Delete can be added later if required.

- [x] **4.7 Server-time anchored countdown** ✅
  - Done 2026-06-07. `components/matches/Countdown.tsx` anchors to `serverNow` from the feed response. The compute function uses `serverNow + (Date.now() - pageLoad)` so the device clock cannot manipulate the displayed countdown.

- [ ] **4.8 Unit tests for `isLocked` boundary** ⏭ deferred
  - Needs Vitest (0.13) first.

---

## Phase 5 — Scoring & Leaderboards (spec §1.5, §3.4, §4.3, §5 Phase 5)

- [x] **5.1 Strategy interface + registry** ✅
  - Done 2026-06-07. `lib/scoring/types.ts` (`ScoringStrategy` interface, `StrategyInput`, `StrategyResult`, `stageConfigFor` helper) + `lib/scoring/index.ts` (`getStrategy(marketType)` with the registry, throws on unknown).

- [x] **5.2 `EXACT_SCORE` strategy** ✅
  - Done 2026-06-07. `lib/scoring/exact-score.ts`. Implements all three rules: exact match → `exactScorePoints`, outcome match (W/D/L) → `outcomePoints`, BTTS bonus stacked on top when both real and predicted have BTTS. Reads stage from `scoringConfig[matchStage]`.
  - Unit tests deferred (needs Vitest).

- [x] **5.3 `OUTRIGHT_TEXT` strategy** ✅
  - Done 2026-06-07. `lib/scoring/outright-text.ts`. Normalizes both sides (`toLowerCase().trim()`), exact match grants `staticPoints`.

- [x] **5.4 `PROPOSITION_CHOICE` strategy (placeholder)** ✅
  - Done 2026-06-07. `lib/scoring/proposition-choice.ts` — returns `{ points: 0, breakdown: "PROPOSITION_CHOICE not yet implemented" }`. Future implementations are a one-file change.

- [x] **5.5 Settlement service** ✅
  - Done 2026-06-07. `lib/services/settle-market.ts` — `settleMarket({ marketId, correctAnswer })`. Validates not-already-settled, sets `BetMarket.correctAnswer` + `isSettled`, sets `Match.status = FINISHED` (if anchored), iterates all `UserBet` rows for the market across every group, runs the strategy with the group's `scoringConfig`, persists `pointsAwarded`. Returns `{ scoredRows, byGroup[] }`. API: `app/api/v1/admin/markets/settle/route.ts`.

- [x] **5.6 Schema addition: `UserBet.pointsAwarded`** ✅
  - Done 2026-06-07. Migration `20260607230000_add_userbet_points_awarded` applied. Field is nullable `Int?`. Index added for the leaderboard aggregation.

- [x] **5.7 Market Settlement Hub UI** ✅
  - Done 2026-06-07. `app/(app)/admin/settlement/page.tsx` + `components/admin/SettlementForm.tsx`. Lists unsettled markets sorted by kickoff, with type-aware placeholders ("2-1" for EXACT_SCORE, "Argentina" for OUTRIGHT_TEXT, first option for PROPOSITION_CHOICE). After settle, shows scored count and per-group breakdown. Admin home card now links here.

- [x] **5.8 Leaderboard query** ✅
  - Done 2026-06-07. `lib/services/leaderboard.ts` — `getGroupLeaderboard(groupId)`. Aggregates `UserBet.pointsAwarded` grouped by user, restricted to the group. Members with no settled bets still appear with 0 points. Returns ranked entries (rank 1 = highest).

- [x] **5.9 Leaderboard view** ✅
  - Done 2026-06-07. `app/(app)/groups/[groupId]/leaderboard/page.tsx` + `components/leaderboard/LeaderboardList.tsx`. Ranked list with #N, emoji + nickname, settled-bet count, total points. First place gets a primary border highlight. Each row links to member history.

- [x] **5.10 Member history view** ✅
  - Done 2026-06-07. `app/(app)/groups/[groupId]/members/[userId]/page.tsx` + `lib/services/member-history.ts`. Shows all bets (settled + pending) with the re-computed breakdown, the prediction, the correct answer (if settled), and the points.

- [ ] **5.11 End-to-end scoring test** ⏭ deferred
  - Needs Vitest (0.13).

---

## Phase 6 — External API Integration: api-football.com (spec §1.4, §2)

- [x] **6.1 Schema: external provider fields on Competition + Match** ✅
  - Done 2026-06-07. Migration `20260608040000_external_provider_fields` applied.
  - `Competition.externalSource`, `externalLeagueId`, `externalSeason`, `lastSyncedAt` (all nullable — NULL for hand-seeded comps, non-NULL for auto-synced).
  - `Match.homeScore`, `Match.awayScore`, `Match.externalStatus` (all nullable — final score + raw status from the provider).
  - `@@index([externalSource])` on Competition for the cron scan query.
  - Acceptance: `npx prisma validate` + migration applied cleanly.

- [x] **6.2 API client: api-football.com** ✅
  - Done 2026-06-07. `lib/services/api-football.ts` — typed HTTP client with 5-min in-memory cache (free tier = 100 req/day).
  - `searchLeagues(query)`, `getLeagueFixtures(leagueId, season)`, `getFixture(id)`, `getLeagueById(id)`.
  - Strict TS types (`League`, `Fixture`, `Status`, `ApiFootballError`) — response nests `id/date/status` under a `fixture` object.
  - Acceptance: client caches responses, handles errors with status + body.

- [x] **6.3 Ingestion service: onboard leagues** ✅
  - Done 2026-06-07. `lib/services/ingest-league.ts` — `ingestLeague()` creates Competition + upserts all fixtures + default EXACT_SCORE market per match. `syncCompetition()` updates kickoff/score/status for existing matches, auto-settles EXACT_SCORE via `settleMarket()` when status=FT with goals. `syncAllCompetitions()` is the cron entry point.
  - Status mapping: FT/AET/PEN/AWD/WO → FINISHED, else SCHEDULED.
  - Stage mapping: round label → GROUP_STAGE / REGULAR_SEASON / KNOCKOUT.
  - Idempotent: re-running updates existing rows, no duplicates.

- [x] **6.4 CRON scheduling + CLI** ✅
  - Done 2026-06-07. `app/api/v1/cron/sync/route.ts` — GET handler guarded by `CRON_SECRET` Bearer token. Calls `syncAllCompetitions()`. `vercel.json`: `*/7 * * * *`.
  - `scripts/sync-fixtures.ts` — CLI entry (`npm run sync:fixtures`) uses local Prisma, bypasses server-only route.
  - Acceptance: cron hits the endpoint, syncs all external competitions, logs results.

- [x] **6.5 Admin UI: League Roster & search** ✅
  - Done 2026-06-07.
  - `app/(app)/admin/leagues/page.tsx` — lists onboarded + manual competitions with sync button per row (Auto-Sync column shows last synced time or "Manual").
  - `app/(app)/admin/leagues/new/page.tsx` — search box, dropdown of leagues x seasons, ingest button per season (greys out once taken).
  - `app/api/v1/admin/leagues/search/route.ts` — POST server-side proxy to api-football.com (hides API key from client).
  - `components/admin/LeagueSearchForm.tsx` — typeahead search with debounce, season picker.
  - `components/admin/SyncCompetitionButton.tsx` — triggers re-sync for a single competition.
  - Admin index updated with a 'League Roster' card.
  - Acceptance: admin can search, onboard, and manually trigger sync from the UI.

- [x] **6.6 Env var: FOOTBALL_API_KEY** ✅
  - Done 2026-06-07. Env var renamed from `API_FOOTBALL_KEY` → `FOOTBALL_API_KEY` (matches user's actual `.env.local`). `.env` placeholder removed (only `.env.local` kept — it's the one Next.js reads).
  - Acceptance: `npm run sync:fixtures` connects and ingests data.

- [x] **6.7 Policy: current/upcoming seasons only** ✅
  - Done 2026-06-08. `ingestLeague()` now calls `getLeagueById(id)` and verifies the requested season is marked `current` by api-football. Throws if not. Belt-and-suspenders: also rejects seasons >1 year in the past.
  - `LeagueSearchForm`: hides non-current season buttons entirely, shows a small 'N past seasons hidden' note.
  - Verified: WC 2026 current=true, WC 2022 current=false, PL 2025 current=true, PL 2024 current=false.

---

## Phase 7 — Betting Market Expansion (spec §1.2, §1.4) — REDESIGNED 2026-06-08

The original Phase 7 (HT_FT + PENALTY_SHOOTOUT) was reviewed and replaced
on 2026-06-08 with a cleaner pair of markets: HALF_SCORING and
IN_GAME_PENALTY. Entries 7.1–7.5 below are kept as an audit trail
(marked REPLACED); the new shape lives in 7.6–7.8.

**Why redesign:**
- HT_FT's 9-option grid (H/H, H/D, …) was hard to reason about and the
  W/D/L+outcome partial credit was hard to explain to new users.
- PENALTY_SHOOTOUT was mis-named: the original spec intent was an
  in-game penalty (regular/extra time), not the post-match shootout. The
  data source (api-football) only exposes shootout penalties, so the
  market was effectively unscoreable as designed.
- The new markets have a smaller option surface, crisper semantics, and
  a clear auto-settle path (where data permits).

**Replaced by:**
- HT_FT → `HALF_SCORING` "Which teams score in which half?"
- PENALTY_SHOOTOUT → `IN_GAME_PENALTY` "Which team gets an in-game penalty?"

**Migration impact:** None — no schema changes were needed. The 7.1
migration (`20260608050000_match_ht_and_penalties`) is still in use
(HALF_SCORING reads `homeHtGoals`/`awayHtGoals`); the
`homePenalties`/`awayPenalties` columns are now unused but retained
(no destructive change to the schema in this refactor).

**Legacy-row safety:** `lib/services/settle-market.ts` now wraps
`getStrategy(market.type)` in a try/catch. If a legacy HT_FT or
PENALTY_SHOOTOUT row exists, settlement logs a warning and skips the
per-bet scoring loop (the market is still marked `isSettled=true` and
its `correctAnswer` is preserved). This keeps the cron from crashing
on pre-redesign data.

---

- [x] **7.1 Schema: HT goals + penalty fields on Match** ✅ (REPLACED — schema columns retained; HT goals still drive HALF_SCORING)
  - Done 2026-06-08. Migration `20260608050000_match_ht_and_penalties` applied.
  - `Match.homeHtGoals`, `Match.awayHtGoals` (nullable Int — half-time score, drives HALF_SCORING).
  - `Match.homePenalties`, `Match.awayPenalties` (nullable Int — shootout result, now unused by any market; kept for forward compatibility).
  - Acceptance: migration applied, all existing rows have NULL for these fields.

- [x] **7.2 HT/FT (Half-time / Full-time) market** — **REPLACED by 7.6**
  - Original 2026-06-08: 9-option HT_FT market, exact=exactScorePoints, 1-of-2=outcomePoints/2.
  - Replaced 2026-06-08 by `HALF_SCORING` (see 7.6). `lib/scoring/ht-ft.ts` deleted.

- [x] **7.3 Penalty Shootout market** — **REPLACED by 7.7**
  - Original 2026-06-08: HOME/AWAY/NO_SHOOTOUT market, exact=exactScorePoints.
  - Replaced 2026-06-08 by `IN_GAME_PENALTY` (see 7.7). `lib/scoring/penalty-shootout.ts` deleted.

- [x] **7.4 Auto-settle HT/FT + Penalty on FT detection** — **REPLACED by 7.6 (HALF_SCORING) + 7.7 (IN_GAME_PENALTY, manual only)**
  - Original 2026-06-08: settled HT_FT and PENALTY_SHOOTOUT on FT detection.
  - Replaced 2026-06-08: HALF_SCORING auto-settles from the score object; IN_GAME_PENALTY has no auto-settle path (API doesn't expose in-game penalty data) — admin settles manually via the Settlement Hub.

- [x] **7.5 PredictionForm: HT_FT + PENALTY_SHOOTOUT display** — **REPLACED by 7.8, then 7.10**
  - Original 2026-06-08: 9-button grid for HT_FT, 3-pill picker for PENALTY_SHOOTOUT.
  - Replaced 2026-06-08: multi-select chip picker for HALF_SCORING (cap=2, count visible), 3-pill picker for IN_GAME_PENALTY (see 7.8).
  - Replaced again 2026-06-08 by the per-match form in 7.10 — `PredictionForm.tsx` was deleted in favor of `MatchBettingForm.tsx`.

- [x] **7.6 HALF_SCORING market (replaces HT_FT)** ✅ (REPLACED by 7.10 — scoring rule changed to per-pick ±1 with -1 floor)
  - Done 2026-06-08. New market type `HALF_SCORING` with 4 options: `A_1H`, `A_2H`, `B_1H`, `B_2H` (A = home, B = away, 1H/2H = which half).
  - **Multi-select:** users pick exactly 2 options. UI cap enforced client-side; server validates "exactly 2 distinct valid codes, no duplicates".
  - **Storage:** comma-separated string, e.g. `"A_1H,B_2H"`. Order is irrelevant (parsed as a Set).
  - **Scoring (original):** `lib/scoring/half-scoring.ts` returned the size of the intersection between predicted and correct sets, capped at the predicted set size. Range 0–2.
  - **Scoring (REPLACED by 7.10):** per-pick ±1 with -1 floor. Each of the 2 picks: +1 if in the correct set, -1 if not. Sum, then `Math.max(-1, sum)`. Range: -1 to +2.
  - **Auto-settle:** `applyFixtures` in `ingest-league.ts` derives the correct answer from the score object: `A_1H` if `homeHtGoals > 0`, `A_2H` if `(homeScore - homeHtGoals) > 0`, `B_1H` if `awayHtGoals > 0`, `B_2H` if `(awayScore - awayHtGoals) > 0`. Only fires when BOTH `homeHtGoals` and `awayHtGoals` are non-null.
  - Created on every ingested match (both api-football and fixturedownload sources).
  - Registered in `lib/scoring/index.ts`. `lib/scoring/ht-ft.ts` deleted.
  - `save-bets-batch.ts`: validates with split-by-comma, exactly 2 distinct codes from the allowed set, no duplicates; throws `SaveBetError(400, …)` on failure.
  - Verification: HALF_SCORING bets save and score correctly end-to-end.

- [x] **7.7 IN_GAME_PENALTY market (replaces PENALTY_SHOOTOUT)** ✅ (REPLACED by 7.10 — scoring rule changed to +3/-2 with -1 floor)
  - Done 2026-06-08. New market type `IN_GAME_PENALTY` with 3 options: `HOME`, `AWAY`, `NONE`.
  - Refers to a penalty awarded during regular/extra time, NOT the post-match shootout (the original spec intent).
  - **Auto-created** on every ingested match (group stage + knockout) in both api-football and fixturedownload pipelines.
  - **No auto-settle:** the api-football feed only exposes shootout penalties, not in-game penalties. Admin enters the correct answer manually via the Settlement Hub.
  - **Scoring (original):** `InGamePenaltyStrategy.score` returned 3 points on exact match (case-insensitive on both sides), 0 otherwise. No negatives.
  - **Scoring (REPLACED by 7.10):** +3 on exact match, -2 on miss, then `Math.max(-1, raw)`. Range: -1 to +3. The -1 floor is the per-bet minimum (no single bet ever costs more than -1).
  - `save-bets-batch.ts`: case-insensitive on input, normalized to uppercase for storage; accepts HOME/AWAY/NONE only.
  - Registered in `lib/scoring/index.ts`. `lib/scoring/penalty-shootout.ts` deleted.

- [x] **7.8 PredictionForm: HALF_SCORING + IN_GAME_PENALTY display** ✅ (REPLACED by 7.10 — per-match form)
  - Done 2026-06-08. `components/matches/PredictionForm.tsx` updated.
  - **HALF_SCORING:** new multi-select chip picker. User can toggle up to 2 options; the other buttons become visually disabled once 2 are selected. A `Pick 2 — N/2 selected` counter is shown above the chips. Submit value is the comma-separated string (e.g. `"A_1H,B_2H"`). On load, `market.viewerBet.predictedValue` is split by comma and the matching chips are pre-selected.
  - **IN_GAME_PENALTY:** 3-pill single-select chip picker, same UI as `PROPOSITION_CHOICE`.
  - HT_FT and PENALTY_SHOOTOUT branches removed; legacy rows render as a generic proposition (with no styling branching on the removed type).
  - Locked-state display: HALF_SCORING values shown as `"A_1H + B_2H"` (joined with ` + `) for readability.
  - **REPLACED 2026-06-08 by 7.10:** `PredictionForm.tsx` deleted. The per-market form is replaced by `MatchBettingForm.tsx`, which renders one form per match containing all 4 markets with a single Save button at the bottom.

- [x] **7.9 Seed data + UI label updates** ✅
  - Done 2026-06-08. Three connected changes so the user can wipe & re-onboard cleanly.
  - **`prisma/seed/fixtures/wc-2026-group-stage.json`:** added a `HALF_SCORING` market (title "Which teams score in which half?", options `["A_1H","A_2H","B_1H","B_2H"]`) to each of the 5 group-stage matches. The `wc26-outright-winner` match is unchanged (it keeps only its `OUTRIGHT_TEXT` markets).
  - **`prisma/seed.ts`:** extended the `MarketInput` type union from `"EXACT_SCORE" | "OUTRIGHT_TEXT" | "PROPOSITION_CHOICE"` to also include `"HALF_SCORING" | "IN_GAME_PENALTY"`.
  - **`scripts/wipe-db.ts` + `npm run wipe:db`:** new one-shot wipe. Deletes `UserBet` → `BetMarket` → `GroupMember` → `Group` → `Match` → `Competition` in FK-safe order, all inside a single `prisma.$transaction([...])`. Preserves `User` rows. Requires `WIPE_CONFIRM=yes-i-am-sure` in the env or refuses safely (exits 0). Idempotent — re-runs on empty DB are no-ops.
  - **`components/matches/PredictionForm.tsx`:** added two exported label maps — `HALF_SCORING_LABELS` (`A_1H` → "Home 1H", `A_2H` → "Home 2H", `B_1H` → "Away 1H", `B_2H` → "Away 2H") and `IN_GAME_PENALTY_LABELS` (`HOME` → "Home team", `AWAY` → "Away team", `NONE` → "No penalty"). The chip pickers render the human-readable label as text content, but the onClick handlers still toggle / set the underlying canonical code — the value state, saved bet, validation, and scoring strategy all continue to use the codes. `formatValue()` updated so the locked-state display shows the labels (e.g. `"A_1H,B_2H"` → `"Home 1H + Away 2H"`).
  - **`components/matches/MatchCard.tsx`:** small description paragraphs rendered below the market title for the two new market types — `"Pick 2 — +1 per correct, 0 per miss"` for HALF_SCORING and `"+3 for correct, 0 for miss"` for IN_GAME_PENALTY. Styled `text-xs text-muted-foreground`.
  - **Usage:** `WIPE_CONFIRM=yes-i-am-sure npm run wipe:db && npm run db:seed`. The wipe script does NOT pass the env var — the user must set it themselves.

---

## Phase 7.10 — Big redesign: 4 markets, per-bet floor -1, one save button, stage-dependent scoring

- [x] **7.10 Big redesign: 4 markets, per-bet floor -1, one save button, stage-dependent scoring** ✅ (REPLACED by 7.10.1 — WIN_TEAM folded into EXACT_SCORE)
  - Done 2026-06-08. Replaces 7.5/7.6/7.7/7.8. The user's design pass re-imagined the betting surface; this entry captures the full sweep. **Wipe + re-seed required** to apply (`WIPE_CONFIRM=yes-i-am-sure npm run wipe:db && npm run db:seed`).
  - **4 markets per match (replaces the 3-market shape from 7.6/7.7/7.8):**
    1. `EXACT_SCORE`   — "Predict the final score" — **required** — +3 group / +5 knockout on exact match, 0 on miss. BTTS bonus dropped.
    2. `WIN_TEAM`      — "Who will win?" (NEW) — **required** — HOME / DRAW / AWAY. +1 group / +2 knockout on match, 0 on miss. Auto-settles from the final score (HOME if home>away, DRAW if equal, AWAY if away>home).
    3. `HALF_SCORING`  — "Which teams score in which half?" — **optional** — per-pick ±1 with -1 floor. +1 per correct code, -1 per wrong code, sum, then `Math.max(-1, sum)`. Range: -1 to +2. Auto-settles from HT + final scores.
    4. `IN_GAME_PENALTY` — "Which team gets an in-game penalty?" — **optional** — +3 on match, -2 on miss, then `Math.max(-1, raw)`. Range: -1 to +3. Manual settlement only (API doesn't expose in-game penalty data).
  - **Per-bet floor of -1:** no individual bet ever costs the user more than -1 point. Applied centrally in `lib/services/settle-market.ts` as `Math.max(-1, result.points)` BEFORE persisting to `UserBet.pointsAwarded`. This is the single source of truth — strategies return their natural values, the settlement clamps. The `byGroup` totalPoints aggregation also uses the clamped value for consistency.
  - **Stage-dependent scoring:** `lib/scoring/default-config.ts` updated. New `winTeamPoints` field on `StageScoring`. Values:
    - GROUP_STAGE: `winTeamPoints=1`, `exactScorePoints=3`.
    - All knockout stages (ROUND_OF_16, QUARTER_FINAL, SEMI_FINAL, FINAL, THIRD_PLACE): `winTeamPoints=2`, `exactScorePoints=5`.
    - OUTRIGHT: unchanged (staticPoints=15 for OUTRIGHT_TEXT markets; all others 0).
  - **One save button per match.** `components/matches/MatchBettingForm.tsx` is a new client component that renders all 4 markets for a match in a single form. The Save button at the bottom is disabled if WIN_TEAM or EXACT_SCORE is missing. HALF_SCORING and IN_GAME_PENALTY are visually marked as "Optional" and can be skipped. On submit, all 4 picks (or fewer if optionals skipped) are sent to `saveBetsBatch` in one call. `components/matches/PredictionForm.tsx` deleted. `components/matches/MatchCard.tsx` rewritten to render one `MatchBettingForm` per match (no more per-market loop).
  - **Multi-market save flow.** `lib/services/save-bets-batch.ts` replaces `lib/services/save-bet.ts` (now a thin re-export shim). `saveBetsBatch(userId, { groupId, matchId, picks })` validates: user is a member; match exists and is not in the 5-min lockdown window; WIN_TEAM and EXACT_SCORE are both present in `picks` (else throws `SaveBetError(400, "Missing required pick: <TYPE>", fieldName)`); each `marketId` exists on the match; each value passes per-type `validatePrediction`. Upserts one `UserBet` per pick (preserves `availableFrom` on update). **Delete behavior:** if a previously-bet-on OPTIONAL market is NOT in the new `picks` map, the stale `UserBet` row is DELETED (so users can fully remove a pick). `app/api/v1/bets/save/route.ts` and `app/(app)/groups/[groupId]/matches/actions.ts` updated to use the new payload shape `{ groupId, matchId, picks: Record<marketId, value> }`. The Server Action is renamed `saveBetsBatchAction`.
  - **Ingest updates:** `lib/services/ingest-league.ts`, `lib/services/ingest-fixturedownload.ts`, and `scripts/ingest-fixturedownload.ts` all create the WIN_TEAM market on every ingested match (in addition to the existing 3). The api-football pipeline auto-settles WIN_TEAM on FT detection alongside EXACT_SCORE. WIN_TEAM_OPTIONS = `["HOME","DRAW","AWAY"]`.
  - **Seed data:** `prisma/seed/fixtures/wc-2026-group-stage.json` extended — each of the 5 group-stage matches now has 4 markets `[EXACT_SCORE, WIN_TEAM, HALF_SCORING, IN_GAME_PENALTY]`. The OUTRIGHT match is unchanged (no WIN_TEAM on outright). `prisma/seed.ts` MarketInput type union extended with `"WIN_TEAM"`.
  - **Settlement:** `lib/services/settle-market.ts` wraps `result.points` with `Math.max(-1, result.points)` before persisting, and uses the clamped value in the byGroup aggregation.
  - **Feed:** `lib/services/group-feed.ts` extended — `FeedMarket.viewerBet` now includes `pointsAwarded: number | null` so the locked/settled row in `MatchBettingForm` can render the per-bet score.
  - **Replaced:** 7.5, 7.6, 7.7, 7.8 (each marked with a REPLACED-by-7.10 supersedes note above).

- [x] **7.10.1 Drop WIN_TEAM + collapse matches list by day** ✅
  - Done 2026-06-08. Two refinements on top of 7.10: (1) drop the separate WIN_TEAM market — derive the winner from the predicted EXACT_SCORE pick; (2) collapse the matches list so only the first 2 days are open by default, the rest are closed accordions. **Wipe + re-seed required** (`WIPE_CONFIRM=yes-i-am-sure npm run wipe:db && npm run db:seed`).
  - **WIN_TEAM credit folded into EXACT_SCORE.** `lib/scoring/exact-score.ts` is rewritten. New scoring: exact match → `exactScorePoints + winTeamPoints` (with breakdown "Exact score"); winner-only match (HOME/DRAW/AWAY derived from predicted vs. correct score) → `winTeamPoints` (breakdown "Correct winner"); miss → 0. Helper `winner(home, away): "HOME" | "DRAW" | "AWAY"` derives the winner from the score. Draw handling: 1-1 vs 2-2 → both DRAW → winner correct. Invalid input still returns `{ points: 0, breakdown: "Invalid score" }` (no throw). `lib/scoring/win-team.ts` deleted; `lib/scoring/index.ts` registry no longer references it. OUTRIGHT's staticPoints=15 strategy is unchanged (different strategy).
  - **3 markets per match** (was 4): `EXACT_SCORE` (required), `HALF_SCORING` (optional), `IN_GAME_PENALTY` (optional). OUTRIGHT matches keep their OUTRIGHT_TEXT markets. All three ingest paths (`lib/services/ingest-league.ts`, `lib/services/ingest-fixturedownload.ts`, `scripts/ingest-fixturedownload.ts`) and the seed JSON no longer create a WIN_TEAM market. `prisma/seed.ts` MarketInput type union no longer includes `"WIN_TEAM"`. The api-football pipeline no longer auto-settles WIN_TEAM on FT detection.
  - **Form:** `components/matches/MatchBettingForm.tsx` no longer renders the WIN_TEAM chip picker. Required market description now reads: "Required — +3 for exact, +1 for correct winner (group); +5 / +2 (knockout). 0 if wrong." Save button is disabled if EXACT_SCORE is empty. `WIN_TEAM_LABELS` map and the `WinTeamRow` sub-component are removed. The locked-state display no longer has a WIN_TEAM row. Optional markets' description text uses `text-[11px]` (smaller than the previous `text-xs`).
  - **Server validation:** `lib/services/save-bets-batch.ts` — `REQUIRED_MARKET_TYPES = new Set(["EXACT_SCORE"])`. The WIN_TEAM branch in `validatePrediction` is removed. The missing-required error field is `"exactScore"` (no longer also `"winTeam"`). The optional-delete logic is unchanged in shape — only the set of required types is smaller.
  - **Legacy WIN_TEAM rows:** the user has not wiped the DB yet, so existing WIN_TEAM markets and UserBets will linger. `lib/services/settle-market.ts` already wraps `getStrategy(market.type)` in a try/catch — unknown types log a warning and skip scoring. No code change needed. The wipe + re-seed removes them.
  - **Day accordion in MatchList.** `components/matches/MatchList.tsx` rewritten. The day-grouping logic (`groupByDay`) is preserved (UTC-keyed buckets). New: `useState<Set<string>>(openDayKeys)` with a lazy initializer that opens the first 2 day keys. Each day header is a button (`<button type="button" aria-expanded={isOpen}>`) showing "Friday, 12 June 2026 · 5 matches" plus a `▶` chevron that rotates 90° (visual `▼`) when the day is open. When closed, only the header renders (no match cards). The accordion state is local React state — not persisted. The header keeps the existing `micro-label` style.
  - **Density.** `components/matches/MatchCard.tsx` paper-card padding reduced from `p-4 md:p-5` to `p-3 md:p-4` so each card takes less vertical space. The accordion is the big win on perceived density; the smaller padding is the secondary effect.
  - **steps.md updates:** the 7.10 entry is left intact as historical record (its inner list of 4 markets is now superseded by 7.10.1's 3-market shape); 7.10.1 above is the new source of truth.

---

## Phase 8 — Alternative Data Source: fixturedownload.com

- [x] **8.1 fixturedownload.com client** ✅
  - Done 2026-06-08. `lib/services/fixturedownload.ts` — fetches + parses CSV schedule from fixturedownload.com. `isPlaceholderTeam()` filters knockout TBD entries (2A, 'To be announced', etc.).
  - Required because api-football has 0 fixtures for WC 2026 (the schedule isn't published on their platform yet).

- [x] **8.2 fixturedownload ingestion service + CLI** ✅
  - Done 2026-06-08.
  - `lib/services/ingest-fixturedownload.ts` — programmatic service. Default: group stage only (Rounds 1-3). Pass `--all-rounds` to include knockouts.
  - `scripts/ingest-fixturedownload.ts` — CLI entry (`npm run ingest:fd`).
  - Creates EXACT_SCORE + HALF_SCORING + IN_GAME_PENALTY markets per match (all three default markets, no stage gating).
  - Idempotent: re-running updates existing rows, no duplicates.
  - Competition.externalSource = 'fixturedownload', externalLeagueId = null (no numeric id).
  - Verified: 72 group-stage matches ingested for 'FIFA World Cup 2026', first match Mexico vs South Africa on 2026-06-11 19:00 UTC. Re-run shows 0 created / 72 updated.

---

## Phase 9 — Time, Visibility & UI Hardening

- [x] **9.1 Convert Match.kickoffTime to TIMESTAMPTZ** ✅
  - Done 2026-06-08. Migration `20260608030000_kickoff_to_timestamptz` applied.
  - Changed from naive `TIMESTAMP` to `TIMESTAMPTZ`. No data change (DB session is UTC, values interpreted the same) — but makes the instant unambiguous regardless of reader timezone.

- [x] **9.2 Dev time-shift tooling** ✅
  - Done 2026-06-08. `scripts/dev-shift-times.ts` — `npm run dev:shift <offset>` sets all match kickoff times to `now + offset` (e.g. `2h`, `30m`, `-5m`, `1d`). `npm run dev:shift 30m 90m` distributes across a range. `npm run dev:reset-times` restores from seed JSON.
  - Eliminates the 'I ran a SQL UPDATE and forgot' confusion.

- [x] **9.3 UTC display everywhere** ✅
  - Done 2026-06-08. MatchCard now shows BOTH absolute UTC time AND relative 'in 3d 20h'. Day-grouping in MatchList uses UTC dates (consistent across timezones).
  - `lib/time.ts`: new `formatUtc()` helper. All kickoff timestamps formatted with en-GB locale, explicit timeZone: 'UTC'.

- [x] **9.4 Always show countdown (drop 2h gate)** ✅
  - Done 2026-06-08. The 2-hour gate was removed — the countdown component now shows a live timer at all times for open matches (3d 20h, 2h 5m, 12m 30s formatted naturally). Server-time-anchored, cannot be gamed by device clock changes.
  - `components/matches/Countdown.tsx` updated.

- [x] **9.5 UserBet.availableFrom — reveal timing refactoring** ✅
  - Done 2026-06-08. Replaced `isRevealed` boolean with `UserBet.availableFrom DateTime`.
  - Migration `20260608010000_userbet_available_from`: drops `isRevealed` + index, adds `availableFrom` + index (migration `20260608000000_add_userbet_is_revealed` creates the boolean then the next migration replaces it — consolidated).
  - `saveBet` sets `availableFrom = match.kickoffTime` on first save, preserves on update.
  - `group-feed`: masks foreign bets where `availableFrom > now`.
  - `member-history`: same filter; owner always sees their own.
  - `lib/services/reveal-bets.ts` removed (lazy update no longer needed).

- [x] **9.6 force-dynamic on group pages** ✅
  - Done 2026-06-08. Added `export const dynamic = "force-dynamic"` to matches, leaderboard, member-history, and group shell pages. Fixes UI staleness where a match near lockdown appeared editable but was actually locked on the server.

- [x] **9.7 Admin trigger fixes + demote script** ✅
  - Done 2026-06-08.
  - Migration `20260608020000_fix_admin_trigger_uuid_cast`: fixes "operator does not exist: uuid = text" by casting `NEW.id` to uuid in sync_admin_metadata trigger.
  - `scripts/demote-admin.ts` + `npm run admin:demote` — companion to promote script.
  - Auto-load `.env`/`.env.local` in promote-admin.ts so it works without manual sourcing.
  - Better error messages (DATABASE_URL missing, user not found).

---

## Phase 10 — Hardening, RLS, E2E, Deploy (spec §3.2 tenant isolation)

- [ ] **10.1 Supabase RLS policies**
  - Files: `supabase/migrations/<ts>_rls_policies.sql`.
  - Rules:
    - `User`: row visible only to self.
    - `GroupMember`: read if `userId = auth.uid()`; insert only via service role.
    - `UserBet`: read only if `GroupMember.userId = auth.uid()` for the same `groupId`; insert/update only if group membership exists and the match isn't locked (DB-side function `is_match_locked(match_id)`).
    - `Match`, `Competition`, `BetMarket`: read for all authenticated users; write only via service role.
  - Acceptance: a test user signed in via the anon key can read only their own groups' data; direct DB probes fail.

- [ ] **10.2 Service-role key is server-only**
  - Files: `lib/supabase/server.ts` exports a `getServiceSupabase()` that is imported **only** in `app/api/v1/admin/*` and `lib/services/settlement*`. Add a `tests/unit/no-service-role-leak.test.ts` that greps the repo for `SUPABASE_SERVICE_ROLE_KEY` outside `lib/supabase/server.ts` and `app/api/v1/admin/**`.
  - Acceptance: test passes; the only place the env var is referenced is server-side.

- [ ] **10.3 Vitest coverage gate**
  - `package.json` script `test:ci` runs Vitest with `--coverage` and a 70% line threshold on `lib/`.
  - Acceptance: `lib/scoring`, `lib/time`, `lib/services/*` are ≥ 90%; overall `lib/` ≥ 70%.

- [ ] **10.4 Playwright E2E: the three journeys**
  - Files: `tests/e2e/journey-1-organizer.spec.ts`, `journey-2-invited-friend.spec.ts`, `journey-3-active-competitor.spec.ts`.
  - Each runs against a freshly-reset test Supabase project.
  - Acceptance: all three pass in CI.

- [ ] **10.5 Vercel + Supabase production setup**
  - Files: `vercel.json` (if needed for cron — see 10.6), `README.md` updated with deploy steps.
  - Acceptance: pushing to a branch deploys a preview that connects to the staging Supabase project.

- [ ] **10.6 (Optional) Settlement cron**
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
