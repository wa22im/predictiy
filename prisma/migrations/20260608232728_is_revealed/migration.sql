-- Replace the DateTime availableFrom column with a boolean isRevealed flag.
-- The new model: a bet is hidden from other group members UNTIL its
-- underlying match becomes locked (5 min before kickoff) or finishes.
-- The flip is performed lazily by getGroupFeed via
-- revealBetsForLockedMatches() — a single batched UPDATE scoped to the
-- matches the viewer is about to read. The WHERE filter on
-- isRevealed = false makes it idempotent.

DROP INDEX IF EXISTS "UserBet_availableFrom_idx";
ALTER TABLE "UserBet" DROP COLUMN "availableFrom";

ALTER TABLE "UserBet" ADD COLUMN "isRevealed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "UserBet_isRevealed_idx" ON "UserBet"("isRevealed");
