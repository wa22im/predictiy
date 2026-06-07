-- Add UserBet.isRevealed — denormalised visibility flag, flipped once the
-- underlying match's kickoffTime has passed. Anti-snooping rule is now
-- DB-backed (auditable) instead of purely a time computation.
--
-- Backfill: any existing bet whose match is already past kickoff is revealed
-- immediately. Bets whose match has not started yet stay hidden.

ALTER TABLE "UserBet"
  ADD COLUMN "isRevealed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "UserBet_isRevealed_idx" ON "UserBet"("isRevealed");

UPDATE "UserBet" ub
SET "isRevealed" = true
FROM "BetMarket" bm
JOIN "Match" m ON m.id = bm."matchId"
WHERE ub."marketId" = bm.id
  AND m."kickoffTime" <= NOW();
