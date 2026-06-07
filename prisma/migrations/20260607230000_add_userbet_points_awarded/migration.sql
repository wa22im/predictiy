-- AlterTable
ALTER TABLE "UserBet" ADD COLUMN "pointsAwarded" INTEGER;

-- CreateIndex
CREATE INDEX "UserBet_pointsAwarded_idx" ON "UserBet"("pointsAwarded");
