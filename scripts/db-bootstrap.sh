#!/usr/bin/env bash
# db-bootstrap.sh — wipe the public schema and re-bootstrap from init.sql.
#
# Use case: the predicty Supabase project is in an unknown / broken state
# (free tier has no backups) and we need a canonical fresh-DB recovery path.
# This script:
#
#   1. Drops everything in the `public` schema (the only schema Prisma owns).
#      Supabase-managed schemas (auth, storage, realtime, etc.) are untouched.
#   2. Recreates the empty `public` schema.
#   3. Runs `npm run db:init` (which sets `INIT_CONFIRM=yes-i-am-sure`
#      internally and reads `prisma/init.sql`). The schema is now in a
#      known-good canonical state — no migration history to replay, no
#      `_prisma_migrations` table to repair. This is the only supported
#      fresh-DB path; the project no longer uses a Prisma migration
#      directory.
#   4. Runs the seed to populate the dev fixtures (FIFA World Cup 2026
#      group stage).
#   5. Prints a reminder to re-promote the calling user as admin via
#      `npm run admin:promote -- your@email.com`. The seed does NOT create
#      an admin; you must do this step yourself after signing up again.
#
# Why this script instead of `prisma migrate reset`:
#
#   The project no longer carries a Prisma migration directory. The
#   authoritative schema lives in `prisma/init.sql` (a single SQL file
#   the `db:init` script applies top-to-bottom). `prisma migrate reset
#   --force` would attempt to apply a migration history that doesn't
#   exist and fail. A bare `DROP SCHEMA public CASCADE` followed by
#   `npm run db:init` is the lowest-level, most predictable primitive.
#
# Confirmation guard:
#
#   The script prompts for the literal string "wipe-predicty" before
#   doing anything destructive. The prompt also echoes the database
#   host (from DATABASE_URL or DIRECT_URL) so the operator can verify
#   they are pointed at the intended target. There is no --yes flag and
#   no `yes |` piping — destruction is a deliberate keystroke.
#
#   For CI / automation, set the env var WIPE_CONFIRMED=wipe-predicty
#   before invoking; the script will skip the prompt. Document any
#   automated use in the commit message.
#
# What this script does NOT do:
#
#   * Does not drop objects outside the `public` schema. Supabase auth
#     tables, storage buckets, and realtime state are untouched.
#   * Does not delete the Supabase project itself.
#   * Does not run the Next.js dev server or the Vercel deploy.
#   * Does not modify any file in this repo.
#   * Does not preserve any data. The free Supabase tier does not retain
#     backups; once this script runs, the previous contents of the public
#     schema are gone.
#
# Usage:
#
#   # Interactive (default):
#   ./scripts/db-bootstrap.sh
#
#   # From your local machine with prod .env.local:
#   cp .env.example .env.local   # if you haven't already
#   # fill in DATABASE_URL and DIRECT_URL for the target Supabase project
#   ./scripts/db-bootstrap.sh
#
#   # Non-interactive (CI / automation):
#   WIPE_CONFIRMED=wipe-predicty ./scripts/db-bootstrap.sh
#
# After the script finishes:
#
#   1. Sign up at https://predicty.vercel.app/signup with the same email
#      you used before (this re-creates your auth.users row and triggers
#      handle_new_user to create the public.User row).
#   2. Re-promote yourself as admin:
#        npm run admin:promote -- your@email.com
#   3. Verify /dashboard renders.

set -euo pipefail

# --- Locate the repo root so the script works from any cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- Resolve the target database URL. Prefer DIRECT_URL (the connection
#     that bypasses pgBouncer and is safe for DDL), fall back to
#     DATABASE_URL. If neither is set, the script aborts before doing
#     anything destructive.
TARGET_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -z "$TARGET_URL" ]]; then
  echo "ERROR: neither DIRECT_URL nor DATABASE_URL is set in the environment." >&2
  echo "       Source your .env.local or export the variable before running." >&2
  exit 1
fi

# Extract the host portion of the URL for the confirmation prompt. The
# connection string has the form
#   postgresql://user:pass@host:port/db?...
# We grab everything between @ and the next / or ?
DB_HOST="$(printf '%s' "$TARGET_URL" | sed -nE 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/@]*@([^/?]+).*$#\1#p')"
DB_NAME="$(printf '%s' "$TARGET_URL" | sed -nE 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/@]*@[^/?]+/([^?]+).*$#\1#p')"

# --- Confirmation guard.
echo
echo "This will DROP the entire 'public' schema on:"
echo "  host: ${DB_HOST:-unknown}"
echo "  database: ${DB_NAME:-unknown}"
echo
echo "After the drop, prisma/init.sql will be re-applied from scratch"
echo "and the dev seed will run. This is irreversible on the free"
echo "Supabase tier (no backups)."
echo

if [[ "${WIPE_CONFIRMED:-}" != "wipe-predicty" ]]; then
  printf 'Type "wipe-predicty" to continue, anything else to abort: '
  read -r REPLY
  echo
  if [[ "$REPLY" != "wipe-predicty" ]]; then
    echo "Aborted. No changes made."
    exit 0
  fi
fi

# --- Step 1: drop and recreate the public schema.
# We use psql via the connection string. -v ON_ERROR_STOP=1 makes psql
# exit non-zero on any SQL error, so a typo in the DROP doesn't silently
# leave us in a half-broken state.
echo "[1/4] Dropping and recreating the public schema..."
if command -v psql >/dev/null 2>&1; then
  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
else
  # Fall back to the Supabase SQL editor or a Node script if psql is not
  # installed locally. We print the SQL and refuse to continue.
  echo "ERROR: psql is not installed on this machine." >&2
  echo "       Run the following two statements in the Supabase SQL editor" >&2
  echo "       for project ${DB_HOST}, then re-run this script:" >&2
  echo "         DROP SCHEMA public CASCADE;" >&2
  echo "         CREATE SCHEMA public;" >&2
  exit 1
fi

# --- Step 2: apply prisma/init.sql (the canonical schema).
# `npm run db:init` invokes scripts/db-init.ts, which requires the
# INIT_CONFIRM env var as its own safety guard. We pass it explicitly
# here because the operator has already confirmed destruction via the
# `wipe-predicty` prompt above; we don't want db-init.ts to refuse.
echo
echo "[2/4] Applying prisma/init.sql..."
INIT_CONFIRM=yes-i-am-sure npm run db:init

# --- Step 3: seed the dev fixtures.
echo
echo "[3/4] Running the dev seed..."
npm run db:seed

# --- Step 4: remind about admin promotion.
echo
echo "[4/4] Done."
echo
echo "Next steps:"
echo "  1. Open https://predicty.vercel.app/signup and sign up with the"
echo "     email you want to use as admin."
echo "  2. From this repo, run:"
echo "       npm run admin:promote -- your@email.com"
echo "  3. Open https://predicty.vercel.app/dashboard and verify it loads."
