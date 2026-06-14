#!/usr/bin/env bash
# db-bootstrap.sh — wipe the public schema and re-bootstrap from migrations.
#
# Use case: the predicty Supabase project is in an unknown / broken state
# (free tier has no backups) and we need a canonical fresh-DB recovery path.
# This script:
#
#   1. Drops everything in the `public` schema (the only schema Prisma owns).
#      Supabase-managed schemas (auth, storage, realtime, etc.) are untouched.
#   2. Recreates the empty `public` schema.
#   3. Runs `prisma migrate deploy` to apply all 19 migrations in order from
#      scratch. This is the canonical Prisma "fresh DB" path: no migration is
#      skipped, no `migrate resolve --applied` is used, no migrations are
#      marked by hand. Each migration's SQL runs inside Prisma's own
#      transaction and rolls back on failure.
#   4. Runs the seed to populate the dev fixtures (FIFA World Cup 2026
#      group stage).
#   5. Prints a reminder to re-promote the calling user as admin via
#      `npm run admin:promote -- your@email.com`. The seed does NOT create
#      an admin; you must do this step yourself after signing up again.
#
# Why this script instead of `npm run db:reset`:
#
#   `prisma migrate reset --force` has been observed on the free Supabase
#   tier to fail mid-way with P3018 errors (e.g. "column already exists"
#   on what should be a freshly-dropped DB), and the failure leaves the
#   `_prisma_migrations` table in a half-populated state that interferes
#   with the next `migrate deploy`. A bare `DROP SCHEMA public CASCADE`
#   followed by a clean `migrate deploy` is the lowest-level, most
#   predictable primitive. This script does exactly that.
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
#   4. If you are continuing the daily web push feature work, the schema
#      is now in a known-good state and prisma migrate deploy / the
#      20260614010000_daily_push_notifications migration will apply
#      cleanly on top.

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
echo "After the drop, all 19 Prisma migrations will be re-applied from"
echo "scratch and the dev seed will run. This is irreversible on the"
echo "free Supabase tier (no backups)."
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

# --- Step 2: apply all 19 migrations from scratch.
echo
echo "[2/4] Applying all migrations from scratch..."
npx prisma migrate deploy

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
echo
echo "If you are continuing the daily web push feature work, the schema"
echo "is now in a known-good state and the 20260614010000_daily_push_"
echo "notifications migration has been applied as part of step 2."
