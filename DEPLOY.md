# Deployment Guide

Step-by-step checklist for deploying predicty to Vercel with a Supabase Postgres backend.

## Prerequisites

- A **Vercel** account (https://vercel.com) — free tier is fine to start
- A **Supabase** project (https://supabase.com) — the project is already provisioned; see `.env.example` for the project reference
- A **GitHub** repository containing the predicty code (already done if you're reading this)
- A **football-data.org** API token (https://www.football-data.org/) — free tier gives 10 req/min, enough for the cron
- A GitHub Actions workflow (`.github/workflows/football-data-sync.yml`) that hits the Vercel endpoint every hour — see [Cron configuration via GitHub Actions](#cron-configuration-via-github-actions) below

## Step 1 — Supabase project (already provisioned)

The Supabase project exists. You don't need to create one — the project reference in `.env.example` is the production project. If you want a separate staging project, create it in the Supabase dashboard and use its connection strings in a Vercel *Preview* environment (the *Production* environment keeps the values from `.env.example`).

To find the connection strings for a Supabase project:

1. Open the Supabase dashboard
2. **Project Settings** → **Database** → **Connection string** → **URI**
3. Copy both the **transaction-mode pooler** (port 6543, has `?pgbouncer=true`) and the **direct** connection (port 5432, on the `db.<ref>.supabase.co` host)

## Step 2 — Initialize the production database schema

The production database is empty until the schema is applied. There are **no Prisma migrations** in this project — the schema lives in `prisma/init.sql` as a single canonical SQL file. Apply it from your local machine (one-time setup):

```bash
# 1. Set the production DATABASE_URL and DIRECT_URL in your local .env
#    (or in a temporary .env.production — don't commit it)
#    DATABASE_URL = transaction-mode pooler (port 6543)
#    DIRECT_URL   = direct connection (port 5432)

# 2. Apply the canonical schema (drops public, re-creates from init.sql)
INIT_CONFIRM=yes-i-am-sure npm run db:init

# 3. (Optional) seed the dev data
npm run db:seed
```

`npm run db:init` is destructive: it drops the entire `public` schema and re-applies `prisma/init.sql` from scratch. **It is intended for fresh-DB recovery only** — running it on a populated database wipes all data. The `INIT_CONFIRM=yes-i-am-sure` env var is a required safety guard. The script is idempotent at the schema level: the resulting `public` schema is identical whether you run it on an empty DB or re-run it on a freshly-wiped DB.

For the first deploy, run `db:init` once and you're done. After that, Vercel doesn't apply the schema — the application code assumes the schema is already there. (See **Database management** in `AGENTS.md` for the schema-change workflow: edit `prisma/schema.prisma`, regenerate `prisma/init.sql`, run `npm run db:push` against the dev DB.)

## Step 3 — Connect Vercel to the GitHub repo

1. Open https://vercel.com/new
2. **Import** the predicty GitHub repository
3. Vercel auto-detects Next.js — leave the framework preset as-is
4. Don't click "Deploy" yet — configure the env vars first (Step 4)

## Step 4 — Configure environment variables on Vercel

In the Vercel project: **Settings** → **Environment Variables**. Add the following:

### Required for every environment

| Variable | Example | Where to get it |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.<ref>:[PASSWORD]@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true` | Supabase → Project Settings → Database → Connection string (URI) — **transaction-mode pooler (port 6543)** |
| `DIRECT_URL` | `postgresql://postgres.<ref>:[PASSWORD]@db.<ref>.supabase.co:5432/postgres` | Same page — **direct connection (port 5432)** |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Same page — **anon / public** key |
| `APP_URL` | `https://predicty.vercel.app` (or your custom domain) | The public URL Vercel gives the deployment |
| `NEXT_PUBLIC_APP_URL` | Same as `APP_URL` | Same value |
| `CRON_SECRET` | A long random string (e.g. `openssl rand -hex 32`) | Generate it yourself. **Required in production** — the cron handler at `/api/v1/cron/sync` returns 500 if `CRON_SECRET` is not set |
| `FOOTBALL_DATA_TOKEN` | `abc123...` | https://www.football-data.org/ — sign up, copy the token from your profile. Enables the football-data sync that the cron drives |

### Optional

| Variable | Default | Purpose |
|---|---|---|
| `LOCKDOWN_MINUTES` | `5` | Minutes before kickoff when betting locks. Server uses this to enforce the cutoff on `/api/v1/bets/save` |
| `INVITE_COOKIE_NAME` | `predicty_invite` | Name of the httpOnly cookie that caches an invite code across the login/signup flow |

### Environment targeting

Vercel lets you set the same variable at three scopes: **Production**, **Preview**, and **Development**. The values in the table above are the **Production** values. For **Preview** deployments, use a separate Supabase project (or the same project — the schema is shared, the data is not). For **Development**, your local `.env.local` is used; the Vercel Development scope is only relevant for `vercel dev`.

Make sure `CRON_SECRET` matches what you set in the Vercel project — the cron handler expects it as `Authorization: Bearer <CRON_SECRET>` and Vercel injects it automatically.

## Step 5 — Deploy

Either:

- **Push to a branch** — Vercel auto-deploys a Preview URL. Open the Vercel dashboard to see the URL.
- **Or click "Deploy"** in the Vercel dashboard after Step 4.

The first build will:

1. Install dependencies
2. Run `prisma generate` (postinstall hook) to regenerate the Prisma client
3. Run `next build`

A successful build produces a `.vercel` URL. Promote a preview to production via the Vercel dashboard when you're happy with it.

## Step 6 — First-deploy checklist (smoke tests)

After the first successful deployment, work through these in order:

1. **Visit the deployed URL** — the marketing landing page should render.
2. **Sign up as a new user** — `/signup` with email + password. The Supabase "Confirm email" toggle must be **off** for the session to be created immediately (Supabase → Authentication → Providers → Email).
3. **Promote yourself to admin** — from your local machine, with `.env.local` pointing at the production database:
   ```bash
   npm run admin:promote -- your@email.com
   ```
4. **Sign out and back in** — the middleware checks `app_metadata.isAdmin` on every request. After promotion, the next sign-in picks up the new role.
5. **Verify `/admin` is accessible** — you should see the Admin home with the Hydration, Settlement, and League Roster cards.
6. **Onboard a competition** — go to `/admin/leagues/discover`, pick a competition (e.g. Premier League 2025), click **Onboard**. The 3 default markets get created on every match.
7. **Create a pool** — back on the dashboard, create a pool for the competition you just onboarded. Open the invite link in a private window to verify the invite flow.
8. **Place a prediction** — in the new pool, pick a match, enter a score, save. Visit the same pool in a second browser (signed in as someone else) and confirm your bet is masked until the match kicks off.
9. **Test the cron** — the cron runs every hour via the GitHub Actions workflow (`.github/workflows/football-data-sync.yml`). To trigger it manually for testing, either run it from the Actions tab ("Run workflow") or curl the endpoint directly:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://predicty.vercel.app/api/v1/cron/sync
   ```
   A 200 response with `{"footballData": {…}, "apiFootball": {"skipped": true}}` is the expected shape.
10. **Settle a finished match** — wait for a match to finish (or shift dev times with `npm run dev:shift`). Go to `/admin/settlement`, find the tournament, enter the final score + status. The auto-settle runs and the leaderboard updates.

## Step 7 — Ongoing

- The cron at `/api/v1/cron/sync` runs every hour via the GitHub Actions workflow. New fixtures appear automatically; finished matches auto-settle their `EXACT_SCORE`, `HALF_SCORING`, and (where possible) `IN_GAME_PENALTY` markets.
- Use `/admin/settlement` to enter scores for matches the cron can't auto-settle (e.g. `IN_GAME_PENALTY` — football-data doesn't expose in-game penalty data).
- Use `/admin/leagues` to see the onboarding status of every competition, and the **Sync now** button to force a re-sync of any football-data competition.
- Use `/admin/hydration` (the JSON terminal) to manually ingest a competition from a JSON blob. Useful for competitions football-data doesn't cover.

## Cron configuration via GitHub Actions

The cron is driven by a GitHub Actions workflow at `.github/workflows/football-data-sync.yml`. The Vercel cron (`vercel.json` `crons` array) is **superseded** — `vercel.json` is now `{}` and the GitHub workflow is the single source of scheduling truth.

**Why GitHub Actions and not Vercel Cron?** Same goal, simpler plumbing. The action is a one-line `curl` to the Vercel endpoint — no checkout, no install, no separate Lambda. All the actual sync logic still runs on Vercel; the workflow is just the trigger.

**Architecture** — DB is the source of truth. The handler at `app/api/v1/cron/sync/route.ts` reads every `Competition` row with `externalSource = "football-data"` and calls `syncFootballDataCompetition(competitionId)` for each. There is no env var that lists the competitions — onboarding a new football-data competition automatically makes it part of the cron. The per-competition syncs run **sequentially** (with a 200ms gap) to stay under football-data.org's 10 req/min free-tier limit.

### Step 1 — Set the GitHub Secrets

In the GitHub repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add the following two secrets:

| Secret | Value | Notes |
| --- | --- | --- |
| `VERCEL_APP_URL` | `https://predicty.vercel.app` (your production Vercel URL, no trailing slash) | The workflow appends `/api/v1/cron/sync` to this. |
| `CRON_SECRET` | The same value as the `CRON_SECRET` env var on Vercel (from Step 4) | Sent as `Authorization: Bearer <CRON_SECRET>`. The Vercel handler verifies it. |

If you rotate `CRON_SECRET` on Vercel, update the GitHub secret to match.

### Step 2 — Commit the workflow file

The file `.github/workflows/football-data-sync.yml` is already in the repo. Make sure it's on the default branch (`main`) — the action only fires from the default branch unless you configure it otherwise.

### Step 3 — Manually trigger the action

From the GitHub repo: **Actions** → **football-data-sync** → **Run workflow** → **Run workflow**. The workflow runs `curl` against the Vercel endpoint and exits 0 on a 200 response. Check the run logs to confirm the response shape and elapsed time.

### Step 4 — Verify the hourly schedule

The workflow declares `cron: '0 * * * *'` (every hour on the hour, UTC). After a successful first run, the next scheduled run appears on the **Actions** tab within an hour. GitHub schedules can drift by a few minutes — that's expected.

### Step 5 — Check the action logs

Click any run from the **Actions** tab to see the full `curl` output, including the JSON response from Vercel. A healthy run ends with a `200` HTTP status line.

### Code review summary (cron pipeline compliance)

- **DB-driven.** The cron reads from the `Competition` table (`WHERE externalSource = "football-data"`) — no env var lists the competitions.
- **Per-row linkage.** Every `Competition` row stores `externalSource`, `externalLeagueId` (the football-data code), and `externalSeason` (the year). Populated by `lib/services/onboard-competition.ts` at onboarding time.
- **Provider query.** `syncFootballDataCompetition` uses `externalLeagueId` + `externalSeason` to query football-data.org.
- **Auto-settle is transition-aware.** Only fires when the previous status was not `FINISHED` and the new status is `FINISHED`.
- **`lastSyncedAt` is stamped on success only.** A failed sync leaves the timestamp untouched so staleness is visible.
- **Per-competition error isolation.** Each failure is captured in `result.errors`; the cron never throws.
- **Bearer-token auth in production.** The handler returns 500 if `CRON_SECRET` is unset in production, 401 if the Bearer token doesn't match.
- **Idempotent apply.** Matches upsert on `apiMatchId`; markets upsert on `(matchId, type, title)`.
- **Rate-limit-friendly execution.** Sequential `for...of` with a 200ms gap between competitions — stays under the 10 req/min free tier even with 5+ competitions.

### `vercel.json` is now `{}` — the Vercel `crons` array was removed in step 10.7. Scheduling lives in the GitHub workflow, not in Vercel.

## Troubleshooting

**Build fails with "Prisma client not generated"** — the `postinstall` hook should handle this. If it doesn't, ensure `package.json` has `"postinstall": "prisma generate"` (it does).

**Cron returns 500 "CRON_SECRET is required"** — set `CRON_SECRET` in the Vercel project's environment variables (Step 4). The cron handler refuses to run without it.

**Sign-up succeeds but the session is null** — turn off "Confirm email" in Supabase → Authentication → Providers → Email. With confirmation on, the user must click a link in their inbox before a session is created.

**`/admin` redirects to `/dashboard`** — the user isn't an admin. Run `npm run admin:promote -- their@email.com` and have them sign out and back in.

**Predictions appear masked in the locked state** — this is correct. The 5-minute lockdown window before kickoff masks other users' bets. After kickoff, bets reveal. Server-time anchored; device clocks don't affect it.

**Cron returns errors for a competition** — the `errors[]` array in the response carries `{ competitionId, apiMatchId?, message }` per failure. A single competition failing doesn't stop the cron — the others still sync.
