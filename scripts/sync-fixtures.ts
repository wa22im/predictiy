/**
 * Manually trigger a sync of all onboarded competitions.
 * Useful for dev and for the admin "Sync now" button.
 *
 * Usage:
 *   npm run sync:fixtures
 *   npm run sync:fixtures -- --competition <id>   # sync one only
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getLeagueFixtures, ApiFootballError } from "../lib/services/api-football";

/**
 * CLI-local reimplementation of the ingestion logic. The shared
 * service in `lib/services/ingest-league.ts` imports lib/prisma.ts
 * which is marked `server-only` and can't be loaded from a CLI
 * process. Duplicating the loop here is cheaper than refactoring
 * the singleton.
 */
async function cliSyncOne(competitionId: string): Promise<void> {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });

  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
  });
  if (!competition) throw new Error(`Competition ${competitionId} not found`);
  if (!competition.externalLeagueId || !competition.externalSeason) {
    throw new Error(`Competition ${competition.name} has no external link`);
  }

  const fixtures = await getLeagueFixtures(
    Number(competition.externalLeagueId),
    competition.externalSeason,
  );
  let updated = 0;
  for (const f of fixtures) {
    await prisma.match.upsert({
      where: { apiMatchId: String(f.fixture.id) },
      update: {
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        kickoffTime: new Date(f.fixture.date),
        homeScore: f.goals.home,
        awayScore: f.goals.away,
        externalStatus: f.fixture.status.short,
        status: ["FT", "AET", "PEN"].includes(f.fixture.status.short) ? "FINISHED" : "SCHEDULED",
      },
      create: {
        apiMatchId: String(f.fixture.id),
        competitionId: competition.id,
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        kickoffTime: new Date(f.fixture.date),
        homeScore: f.goals.home,
        awayScore: f.goals.away,
        externalStatus: f.fixture.status.short,
        stage: "UNKNOWN",
      },
    });
    updated += 1;
  }
  await prisma.competition.update({
    where: { id: competitionId },
    data: { lastSyncedAt: new Date() },
  });
  await prisma.$disconnect();
  console.log(`  ✓ ${competition.name}: ${updated} fixtures`);
}

async function cliSyncAll(): Promise<number> {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });
  const onboarded = await prisma.competition.findMany({
    where: { externalSource: "api-football" },
    select: { id: true, name: true },
  });
  await prisma.$disconnect();
  let count = 0;
  for (const c of onboarded) {
    try {
      await cliSyncOne(c.id);
      count += 1;
    } catch (e) {
      if (e instanceof ApiFootballError) {
        console.error(`  ✗ ${c.name}: ${e.message}`);
      } else {
        console.error(`  ✗ ${c.name}: ${(e as Error).message}`);
      }
    }
  }
  return count;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Run from project root or set it explicitly.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const compFlag = args.indexOf("--competition");
  const specificId = compFlag >= 0 ? args[compFlag + 1] : null;

  const start = Date.now();
  if (specificId) {
    console.log(`Syncing competition ${specificId}…`);
    await cliSyncOne(specificId);
  } else {
    console.log("Syncing all onboarded competitions…");
    const count = await cliSyncAll();
    console.log(`\nDone in ${Date.now() - start}ms. Synced ${count} competitions.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Sync failed:", e.message);
  process.exit(1);
});

