-- Add a tournament end-date to Competition. Nullable, no default: all
-- existing rows are treated as "no end date known" (active) until
-- the next sync from the provider refreshes the value.
--
-- Reads: lib/services/dashboard.ts:73 filters competitions by
--        "endDate > now" to decide which groups are "active". Before
--        this column existed the filter was a no-op (every
--        competition was active forever); with the column present
--        AND populated, past-season comps disappear from the
--        dashboard as expected.
-- Writes: lib/services/onboard-competition.ts (football-data),
--         lib/services/ingest-league.ts (api-football),
--         lib/services/ingest-fixturedownload.ts (fixturedownload),
--         lib/services/sync-football-data-competition.ts (football-data re-sync).
--         Manual JSON-paste hydration (lib/services/competition-sync.ts)
--         and the seed (prisma/seed.ts) intentionally leave it null.

ALTER TABLE "Competition" ADD COLUMN "endDate" TIMESTAMPTZ(3);
