-- Phase 11: JSONB flexibility, soft delete, score-sync tracking.
--
-- This is a purely additive migration. Each ALTER TABLE adds a single
-- nullable column; no backfill, no default, no NOT NULL constraint, no
-- data loss. Existing rows keep all their values; the new columns are
-- NULL for every pre-existing row.
--
-- Why nullable (no backfill):
--   * `Match.scoreLastSyncedAt` — NULL means "never refreshed via the
--     user-driven path" (i.e. the cron is the only source of data).
--     This is the correct initial state.
--   * `Match.details`, `Competition.details`, `BetMarket.details`,
--     `Group.details` — NULL means "no per-row override". Consumers
--     must treat NULL and `{}` as equivalent (defensive validation).
--   * `Competition.deletedAt` — NULL means "active". The soft-delete
--     endpoint at app/api/v1/admin/competitions/[id]/route.ts writes
--     a timestamp here; reads filter `deletedAt: null` to exclude
--     soft-deleted tournaments from listings.
--
-- Indexes: we do NOT add an index on `Competition.deletedAt`. The
-- primary read path is `prisma.competition.findMany({ where:
-- { deletedAt: null } })`, which currently has a tiny row count (we
-- are pre-launch with a handful of seeded competitions). If the
-- table grows past a few hundred rows we can revisit with a
-- partial index `WHERE deletedAt IS NULL` — but adding it now would
-- slow down writes (every INSERT/UPDATE updates the index) for a
-- table that doesn't need it yet.
--
-- PostgreSQL notes:
--   * ALTER TABLE ... ADD COLUMN with no DEFAULT and no NOT NULL is a
--     metadata-only operation in PG 11+ (the catalog is updated
--     without rewriting the table). It takes a brief ACCESS EXCLUSIVE
--     lock per table but does not block reads or writes for any
--     meaningful duration.
--   * We use TIMESTAMPTZ(3) for the new scoreLastSyncedAt to match
--     the existing Match.kickoffTime column shape (UTC, ms precision).

ALTER TABLE "Match"        ADD COLUMN "scoreLastSyncedAt" TIMESTAMPTZ(3);
ALTER TABLE "Match"        ADD COLUMN "details"           JSONB;
ALTER TABLE "Competition"  ADD COLUMN "deletedAt"         TIMESTAMPTZ(3);
ALTER TABLE "Competition"  ADD COLUMN "details"           JSONB;
ALTER TABLE "BetMarket"    ADD COLUMN "details"           JSONB;
ALTER TABLE "Group"        ADD COLUMN "details"           JSONB;
