-- Add per-half and penalty-shootout score fields to Match.
-- These are populated from api-football's score object:
--   score.halftime.{home,away}  → homeHtGoals / awayHtGoals
--   score.penalty.{home,away}   → homePenalties / awayPenalties (NULL if no shootout)
-- All nullable: stays empty until the match progresses.

ALTER TABLE "Match"
  ADD COLUMN "homeHtGoals"    INTEGER,
  ADD COLUMN "awayHtGoals"    INTEGER,
  ADD COLUMN "homePenalties"  INTEGER,
  ADD COLUMN "awayPenalties"  INTEGER;
