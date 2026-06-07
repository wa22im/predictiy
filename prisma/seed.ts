/**
 * predicty database seed.
 *
 * Idempotent — safe to run multiple times. Uses upserts throughout.
 *
 * Usage:
 *   npm run db:seed
 *
 * Or via Prisma:
 *   npx prisma db seed
 *
 * What this seeds:
 *   - 1 competition (World Cup 2026)
 *   - 5 group-stage matches + 1 outright match (sourced from the JSON fixture)
 *   - 1 default EXACT_SCORE market per match + 2 OUTRIGHT_TEXT markets on the final
 *
 * What this does NOT seed:
 *   - Users (must be created via auth signup; the auth trigger provisions the public.User row)
 *   - Groups (must be created via the dashboard)
 *   - Bets (must be placed by users)
 *
 * After seeding, sign up at /signup, then promote yourself:
 *   npm run admin:promote -- your@email
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

type MarketInput = {
  type: "EXACT_SCORE" | "OUTRIGHT_TEXT" | "PROPOSITION_CHOICE";
  title: string;
  options?: string[];
};

type MatchInput = {
  apiMatchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  stage: string;
  markets: MarketInput[];
};

type Fixture = {
  competition: { name: string };
  matches: MatchInput[];
};

async function main() {
  console.log("🌱 Seeding predicty database…");

  const fixturePath = resolve(
    process.cwd(),
    "prisma/seed/fixtures/wc-2026-group-stage.json",
  );
  const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

  const competition = await prisma.competition.upsert({
    where: { name: fixture.competition.name },
    update: {},
    create: { name: fixture.competition.name },
  });
  console.log(`  ✓ Competition: ${competition.name}`);

  let matchCount = 0;
  let marketCount = 0;

  for (const m of fixture.matches) {
    const match = await prisma.match.upsert({
      where: { apiMatchId: m.apiMatchId },
      update: {
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffTime: new Date(m.kickoffTime),
        stage: m.stage,
        competitionId: competition.id,
      },
      create: {
        competitionId: competition.id,
        apiMatchId: m.apiMatchId,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffTime: new Date(m.kickoffTime),
        stage: m.stage,
      },
    });
    matchCount += 1;

    for (const mk of m.markets) {
      await prisma.betMarket.upsert({
        where: {
          matchId_type_title: {
            matchId: match.id,
            type: mk.type,
            title: mk.title,
          },
        },
        update: {
          options: mk.options ? mk.options : undefined,
        },
        create: {
          matchId: match.id,
          type: mk.type,
          title: mk.title,
          options: mk.options ? mk.options : undefined,
        },
      });
      marketCount += 1;
    }
  }

  console.log(`  ✓ Matches: ${matchCount}`);
  console.log(`  ✓ Markets: ${marketCount}`);

  console.log("\nNext:");
  console.log("  1. Sign up at /signup");
  console.log("  2. npm run admin:promote -- your@email");
  console.log("  3. Visit /admin/hydration to see the seeded data");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
