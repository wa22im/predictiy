-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'GOING', 'FINISHED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT '',
    "emoji" TEXT NOT NULL DEFAULT '⚽',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "externalSource" TEXT,
    "externalLeagueId" TEXT,
    "externalSeason" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "details" JSONB,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "apiMatchId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "kickoffTime" TIMESTAMP(3) NOT NULL,
    "stage" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "homeHtGoals" INTEGER,
    "awayHtGoals" INTEGER,
    "homePenalties" INTEGER,
    "awayPenalties" INTEGER,
    "externalStatus" TEXT,
    "homeCrest" TEXT,
    "awayCrest" TEXT,
    "scoreLastSyncedAt" TIMESTAMP(3),
    "details" JSONB,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionMatch" (
    "matchId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionMatch_pkey" PRIMARY KEY ("matchId","competitionId")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "scoringConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetMarket" (
    "id" TEXT NOT NULL,
    "matchId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" TEXT,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,

    CONSTRAINT "BetMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "predictedValue" TEXT NOT NULL,
    "pointsAwarded" INTEGER,
    "isRevealed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "details" JSONB,

    CONSTRAINT "UserBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_name_key" ON "Competition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Match_apiMatchId_key" ON "Match"("apiMatchId");

-- CreateIndex
CREATE INDEX "Match_competitionId_idx" ON "Match"("competitionId");

-- CreateIndex
CREATE INDEX "Match_kickoffTime_idx" ON "Match"("kickoffTime");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "CompetitionMatch_competitionId_idx" ON "CompetitionMatch"("competitionId");

-- CreateIndex
CREATE INDEX "CompetitionMatch_matchId_idx" ON "CompetitionMatch"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_inviteCode_key" ON "Group"("inviteCode");

-- CreateIndex
CREATE INDEX "Group_competitionId_idx" ON "Group"("competitionId");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_userId_groupId_key" ON "GroupMember"("userId", "groupId");

-- CreateIndex
CREATE INDEX "BetMarket_matchId_idx" ON "BetMarket"("matchId");

-- CreateIndex
CREATE INDEX "BetMarket_isSettled_idx" ON "BetMarket"("isSettled");

-- CreateIndex
CREATE UNIQUE INDEX "BetMarket_matchId_type_title_key" ON "BetMarket"("matchId", "type", "title");

-- CreateIndex
CREATE INDEX "UserBet_groupId_idx" ON "UserBet"("groupId");

-- CreateIndex
CREATE INDEX "UserBet_marketId_idx" ON "UserBet"("marketId");

-- CreateIndex
CREATE INDEX "UserBet_pointsAwarded_idx" ON "UserBet"("pointsAwarded");

-- CreateIndex
CREATE INDEX "UserBet_isRevealed_idx" ON "UserBet"("isRevealed");

-- CreateIndex
CREATE UNIQUE INDEX "UserBet_userId_groupId_marketId_key" ON "UserBet"("userId", "groupId", "marketId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMatch" ADD CONSTRAINT "CompetitionMatch_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMatch" ADD CONSTRAINT "CompetitionMatch_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetMarket" ADD CONSTRAINT "BetMarket_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBet" ADD CONSTRAINT "UserBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBet" ADD CONSTRAINT "UserBet_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBet" ADD CONSTRAINT "UserBet_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "BetMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Business rules (CHECK constraints — not modeled in schema.prisma)
-- ============================================================

-- Custom tournaments (externalSource IS NULL) must have a non-null
-- endDate. Vendor tournaments (externalSource = 'football-data' |
-- 'fixturedownload') may have a null endDate — the vendor sync path
-- populates it when known but is allowed to leave it null. This
-- invariant is also enforced at the Zod layer in
-- `lib/validation/admin.ts` (CreateCustomCompetitionInput requires
-- endDate) and at the API layer in
-- `app/api/v1/admin/competitions/route.ts` (returns 400 on missing
-- endDate). The CHECK constraint is the last line of defense.
ALTER TABLE "Competition"
  ADD CONSTRAINT endDate_required_for_custom
  CHECK ("externalSource" IS NOT NULL OR "endDate" IS NOT NULL);

-- ============================================================
-- Auth triggers (Postgres-specific DDL, not modeled in schema.prisma)
-- ============================================================

-- Auto-provision public.User from auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."User" (id, email, nickname, emoji, "isAdmin")
  VALUES (NEW.id::text, NEW.email, '', '⚽', false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Sync isAdmin to auth.users.raw_user_meta_data
CREATE OR REPLACE FUNCTION public.sync_admin_metadata()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."isAdmin" IS DISTINCT FROM OLD."isAdmin" THEN
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('isAdmin', NEW."isAdmin")
    WHERE id = NEW.id::uuid;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_admin_changed
  AFTER UPDATE OF "isAdmin" ON "User"
  FOR EACH ROW EXECUTE FUNCTION public.sync_admin_metadata();
