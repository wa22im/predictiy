-- Add external-provider tracking to Competition, and final-score
-- fields to Match. Safe for existing data: all new columns are nullable.

ALTER TABLE "Competition"
  ADD COLUMN "externalSource"   TEXT,
  ADD COLUMN "externalLeagueId" TEXT,
  ADD COLUMN "externalSeason"   INTEGER,
  ADD COLUMN "lastSyncedAt"     TIMESTAMPTZ(3);

ALTER TABLE "Match"
  ADD COLUMN "homeScore"      INTEGER,
  ADD COLUMN "awayScore"      INTEGER,
  ADD COLUMN "externalStatus" TEXT;

-- Index for the cron: pick all competitions that have an external
-- source attached so we can sync them.
CREATE INDEX "Competition_externalSource_idx"
  ON "Competition"("externalSource")
  WHERE "externalSource" IS NOT NULL;
