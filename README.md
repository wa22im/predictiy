# predicty

A prediction-pool app for football tournaments. Create a pool, share the invite link, score points for predicting exact scores, half-time scoring, and in-game penalties.

## Features

- **Pools** — create a prediction pool for any competition, share a 10-character invite link
- **Predictions** — predict the exact score, which half each team scores in, and which team gets an in-game penalty
- **Settlement** — the [football-data.org](https://www.football-data.org/) sync cron auto-settles matches when they finish; admins can also settle manually via the Settlement Hub
- **Leaderboards** — ranked list of every member in a pool, with member history drill-down
- **Admin** — discover new competitions via the football-data catalogue, onboard them, sync on demand, and enter scores for matches the API can't auto-settle

## Tech stack

- **Next.js 15.5.19** (App Router, Route Handlers under `/api/v1/*`, Server Actions for forms)
- **React 19.2.7**
- **Prisma 7** with `@prisma/adapter-pg` (generates TS source)
- **Supabase** — Postgres database + magic-link-equivalent email+password auth via `@supabase/ssr`
- **Tailwind CSS v4** with a custom design system (oklch tokens, paper-card / glass-panel / command-strip utilities)
- **Zod** for request/response validation
- **Vercel** for hosting; cron jobs declared in `vercel.json`

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

See `.env.example` for what each variable is and where to get it. The Supabase + Prisma bits are the critical ones for a fresh setup.

### 3. Apply the database schema

```bash
npx prisma migrate deploy
```

This applies all migrations in `prisma/migrations/` to the database pointed at by `DIRECT_URL`.

### 4. (Optional) Seed the dev data

```bash
npm run db:seed
```

Seeds the FIFA World Cup 2026 group-stage matches as a sample competition.

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database

All Prisma operations go through `lib/prisma.ts` (a singleton with a `PrismaPg` adapter). Migrations live in `prisma/migrations/`. To inspect the database:

```bash
npm run db:studio        # opens Prisma Studio in a browser
```

Useful scripts:

| Script | What it does |
|---|---|
| `npm run db:migrate` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run db:reset` | Destructive reset (dev only) |
| `npm run db:seed` | Idempotent seed from `prisma/seed/fixtures/wc-2026-group-stage.json` |
| `npm run db:studio` | Browse the database |
| `npm run db:generate` | Regenerate the Prisma client |

## Admin

By default, new sign-ups are not admins. To promote an existing user to admin:

```bash
npm run admin:promote -- your@email.com
```

Run this locally with `.env.local` pointing at the target database (the script uses `PrismaPg` directly, not the Next.js runtime). The corresponding `npm run admin:demote -- your@email.com` reverses it.

The first admin needs to be promoted before they can access `/admin`, `/admin/settlement`, `/admin/leagues`, or `/admin/leagues/discover`.

## Project structure

```
app/                        # Next.js App Router
├── (app)/                  # auth-required pages
│   ├── dashboard/          # user's pools
│   ├── groups/[groupId]/   # pool shell + tabs (matches, leaderboard, members)
│   ├── admin/              # admin-only (hydration, settlement, leagues, discover)
│   └── onboarding/         # first-time nickname + emoji
├── api/v1/                 # Route Handlers (admin, bets, cron, groups, ...)
├── login/  signup/         # auth pages
└── page.tsx                # public marketing landing
components/                 # UI (auth, groups, matches, leaderboard, admin, ui)
lib/
├── supabase/               # server / client / middleware helpers
├── prisma.ts               # Prisma client singleton
├── auth/                   # session helpers, role guards
├── scoring/                # Strategy Factory (EXACT_SCORE, HALF_SCORING, ...)
├── services/               # domain services (feed, save-bets, settle, sync, ...)
├── time.ts                 # UTC + lockdown helpers
├── invite.ts               # invite-code generation
└── validation/             # Zod request schemas
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
scripts/                    # CLI entries (admin:promote, sync:fixtures, wipe, ...)
vercel.json                 # cron config
```

## Deployment

See [DEPLOY.md](./DEPLOY.md) for the step-by-step Vercel + Supabase production setup, including the env-var checklist, the Prisma migration steps, and the first-deploy smoke tests.
