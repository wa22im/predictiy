-- Replace the boolean isRevealed flag with a DateTime availableFrom column.
-- The new model: a bet's predicted value is hidden from other group members
-- UNTIL availableFrom <= now(). Set to Match.kickoffTime at save time so
-- bets become visible at kickoff. Filtering is a single WHERE clause; no
-- background job or lazy UPDATE required.

DROP INDEX IF EXISTS "UserBet_isRevealed_idx";
ALTER TABLE "UserBet" DROP COLUMN "isRevealed";

ALTER TABLE "UserBet" ADD COLUMN "availableFrom" TIMESTAMP(3);

-- Backfill: for every existing bet, derive availableFrom from the match's
-- kickoffTime. Outright markets (no match) are revealed immediately.
UPDATE "UserBet" ub
SET "availableFrom" = COALESCE(m."kickoffTime", NOW())
FROM "BetMarket" bm
LEFT JOIN "Match" m ON m.id = bm."matchId"
WHERE ub."marketId" = bm.id;

-- Now make it NOT NULL.
ALTER TABLE "UserBet" ALTER COLUMN "availableFrom" SET NOT NULL;

CREATE INDEX "UserBet_availableFrom_idx" ON "UserBet"("availableFrom");
