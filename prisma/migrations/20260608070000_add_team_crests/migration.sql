-- Add team crest URL columns to the Match table.
--
-- These hold the URL of each team's crest/badge, sourced from
-- football-data.org's CDN (or any URL pasted in via the manual
-- hydration terminal). The UI renders a 28-32px image above the
-- team name and falls back to a team-initial circle if the URL
-- is null or fails to load.
--
-- Nullable: legacy matches hydrated before this migration have
-- no crest, and providers that don't return a crest (e.g. some
-- lower-tier teams) leave it null. The database is wiped for
-- this rollout, but the columns are nullable for forward
-- compatibility with any future provider that omits the field.

-- AlterTable
ALTER TABLE "Match" ADD COLUMN "homeCrest" TEXT;
ALTER TABLE "Match" ADD COLUMN "awayCrest" TEXT;
