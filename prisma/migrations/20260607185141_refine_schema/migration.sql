/*
  Warnings:

  - The `status` column on the `Match` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'FINISHED');

-- AlterTable
ALTER TABLE "BetMarket" ADD COLUMN     "options" JSONB;

-- AlterTable
ALTER TABLE "Match" DROP COLUMN "status",
ADD COLUMN     "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "nickname" SET DEFAULT '',
ALTER COLUMN "emoji" SET DEFAULT '⚽';

-- CreateIndex
CREATE INDEX "BetMarket_matchId_idx" ON "BetMarket"("matchId");

-- CreateIndex
CREATE INDEX "BetMarket_isSettled_idx" ON "BetMarket"("isSettled");

-- CreateIndex
CREATE INDEX "Group_competitionId_idx" ON "Group"("competitionId");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember"("groupId");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");
