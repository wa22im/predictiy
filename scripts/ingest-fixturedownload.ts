/**
 * One-shot ingestion from fixturedownload.com.
 *
 * Use this for tournaments whose schedule is published on
 * fixturedownload but not yet on api-football. The current example is
 * FIFA World Cup 2026.
 *
 * Usage:
 *   npm run ingest:fd -- fifa-world-cup-2026 --name "FIFA World Cup 2026"
 *   npm run ingest:fd -- fifa-world-cup-2026 --name "FIFA World Cup 2026" --all-rounds
 *
 * By default only group stage (rounds 1-3) is ingested. Pass
 * --all-rounds to include knockout rounds too (with placeholder team
 * names, which are still skipped).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { fetchFixtures, isPlaceholderTeam, parseDateUtc } from "../lib/services/fixturedownload";

const HALF_SCORING_OPTIONS = ["A_1H","A_2H","B_1H","B_2H"];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Run from project root.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const slug = args[0];
  const nameFlag = args.indexOf("--name");
  const name = nameFlag >= 0 ? args[nameFlag + 1] : null;
  const allRounds = args.includes("--all-rounds");

  if (!slug) {
    console.error("Usage: npm run ingest:fd -- <slug> --name \"<competition name>\" [--all-rounds]");
    console.error("Example: npm run ingest:fd -- fifa-world-cup-2026 --name \"FIFA World Cup 2026\"");
    process.exit(1);
  }
  if (!name) {
    console.error("Missing --name. Example: --name \"FIFA World Cup 2026\"");
    process.exit(1);
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  console.log(`Fetching feed for slug: ${slug}…`);
  const allMatches = await fetchFixtures(slug);
  console.log(`Got ${allMatches.length} matches from feed`);

  // Filter: round <= 3 (group stage) by default; skip placeholders.
  const real = allMatches.filter((m) => {
    if (!allRounds && m.RoundNumber > 3) return false;
    if (isPlaceholderTeam(m.HomeTeam) || isPlaceholderTeam(m.AwayTeam)) return false;
    return true;
  });
  const placeholders = allMatches.filter(
    (m) => isPlaceholderTeam(m.HomeTeam) || isPlaceholderTeam(m.AwayTeam),
  ).length;
  const aboveMax = allMatches.filter((m) => m.RoundNumber > 3).length;

  console.log(
    `Will ingest ${real.length} real matches (skipped ${placeholders} placeholders, ${aboveMax} above max round${allRounds ? " — all-rounds mode" : ""}).`,
  );

  // Year: extract from the first match's date, or use current year
  const firstDate = real[0] ? parseDateUtc(real[0].DateUtc) : new Date();
  const season = firstDate.getUTCFullYear();

  // Upsert competition
  const existing = await prisma.competition.findUnique({
    where: { name },
    select: { id: true },
  });
  const competition = await prisma.competition.upsert({
    where: { name },
    create: {
      name,
      externalSource: "fixturedownload",
      externalLeagueId: null,
      externalSeason: season,
    },
    update: {
      externalSource: "fixturedownload",
      externalSeason: season,
    },
  });
  console.log(`Competition: ${competition.name} (id=${competition.id})${existing ? " — updated" : " — created"}`);

  let mCreated = 0, mUpdated = 0, mkCreated = 0;
  for (const m of real) {
    const existed = await prisma.match.findUnique({
      where: { apiMatchId: `fd-${m.MatchNumber}` },
      select: { id: true },
    });
    const match = await prisma.match.upsert({
      where: { apiMatchId: `fd-${m.MatchNumber}` },
      create: {
        apiMatchId: `fd-${m.MatchNumber}`,
        competitionId: competition.id,
        homeTeam: m.HomeTeam.trim(),
        awayTeam: m.AwayTeam.trim(),
        kickoffTime: parseDateUtc(m.DateUtc),
        stage: m.RoundNumber <= 3 ? "GROUP_STAGE" : "KNOCKOUT",
        status: "SCHEDULED",
      },
      update: {
        homeTeam: m.HomeTeam.trim(),
        awayTeam: m.AwayTeam.trim(),
        kickoffTime: parseDateUtc(m.DateUtc),
        stage: m.RoundNumber <= 3 ? "GROUP_STAGE" : "KNOCKOUT",
      },
    });
    if (existed) mUpdated += 1; else mCreated += 1;

    const exExisted = await prisma.betMarket.findUnique({
      where: { matchId_type_title: { matchId: match.id, type: "EXACT_SCORE", title: "Predict the final score" } },
      select: { id: true },
    });
    await prisma.betMarket.upsert({
      where: { matchId_type_title: { matchId: match.id, type: "EXACT_SCORE", title: "Predict the final score" } },
      create: { matchId: match.id, type: "EXACT_SCORE", title: "Predict the final score" },
      update: {},
    });
    if (!exExisted) mkCreated += 1;

    const halfExisted = await prisma.betMarket.findUnique({
      where: { matchId_type_title: { matchId: match.id, type: "HALF_SCORING", title: "Which teams score in which half?" } },
      select: { id: true },
    });
    await prisma.betMarket.upsert({
      where: { matchId_type_title: { matchId: match.id, type: "HALF_SCORING", title: "Which teams score in which half?" } },
      create: { matchId: match.id, type: "HALF_SCORING", title: "Which teams score in which half?", options: HALF_SCORING_OPTIONS },
      update: { options: HALF_SCORING_OPTIONS },
    });
    if (!halfExisted) mkCreated += 1;
  }

  console.log("");
  console.log("Done:");
  console.log(`  matches:  ${mCreated} created, ${mUpdated} updated`);
  console.log(`  markets:  ${mkCreated} created`);
  console.log("");
  console.log("Sample matches:");
  const sample = await prisma.match.findMany({
    where: { competitionId: competition.id },
    take: 3,
    orderBy: { kickoffTime: "asc" },
  });
  for (const m of sample) {
    console.log(`  ${m.kickoffTime.toISOString()} | ${m.homeTeam} vs ${m.awayTeam}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Ingest failed:", e.message);
  process.exit(1);
});
