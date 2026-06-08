/**
 * One-shot cleanup: delete legacy `HT_FT` and `PENALTY_SHOOTOUT` `BetMarket` rows.
 *
 * Why:
 *   The schema for these market types is being redesigned in a later step,
 *   so the leftover rows from the previous design are no longer wanted.
 *
 * Current data state (informational only — not hardcoded by the script):
 *   - WC 2026 group stage: 72 matches × 1 HT_FT                 =  72 rows
 *   - PL 2024:             380 matches × 1 HT_FT                 = 380 rows
 *   - PENALTY_SHOOTOUT:    none currently in the seeded data     =   0 rows
 *   - Total expected:                                                ~452 rows
 *
 * Safety:
 *   - Idempotent — re-running with zero matches is a no-op and exits 0.
 *   - UserBet.market has onDelete: Cascade on BetMarket, so any
 *     dependent user bets are removed automatically. No orphans.
 *   - A verification count runs after the delete — a non-zero remaining
 *     count is reported and the process exits 1.
 *
 * Usage:
 *   npm run cleanup:legacy
 *   npx tsx scripts/cleanup-legacy-markets.ts
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const LEGACY_TYPES: string[] = ["HT_FT", "PENALTY_SHOOTOUT"];
const LEGACY_WHERE = { type: { in: LEGACY_TYPES } };

export type CleanupResult = {
  deleted: number;
  remaining: number;
};

export async function cleanupLegacyMarkets(): Promise<CleanupResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL not set. Run from project root (loads .env) or set it explicitly.",
    );
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  try {
    const before = await prisma.betMarket.count({ where: LEGACY_WHERE });

    if (before === 0) {
      console.log("No legacy markets to clean up.");
      return { deleted: 0, remaining: 0 };
    }

    console.log(`Found ${before} legacy markets. Deleting...`);
    const result = await prisma.betMarket.deleteMany({ where: LEGACY_WHERE });
    const remaining = await prisma.betMarket.count({ where: LEGACY_WHERE });

    console.log(
      `Deleted ${result.count} legacy markets. Verification count: ${remaining} remaining.`,
    );

    return { deleted: result.count, remaining };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const { remaining } = await cleanupLegacyMarkets();
  process.exit(remaining === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Cleanup failed:", e?.message ?? e);
  process.exit(1);
});
