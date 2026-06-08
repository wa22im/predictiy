/**
 * One-shot wipe: delete all betting-domain rows so the user can re-onboard
 * from a clean slate. Preserves User rows (auth users stay).
 *
 * Why:
 *   The previous session left a partially-hydrated state (legacy
 *   HT_FT / PENALTY_SHOOTOUT markets, hand-seeded group-stage data,
 *   maybe orphan bets). The user wants to nuke and reseed.
 *
 * What this wipes (in this order, to satisfy FK constraints):
 *   1. UserBet        — children of BetMarket + User
 *   2. BetMarket      — children of Match
 *   3. GroupMember    — children of Group + User
 *   4. Group          — children of Competition
 *   5. Match          — children of Competition
 *   6. Competition    — top of the tree
 *
 * What this preserves:
 *   - User (auth + public row) — admin login still works after wipe.
 *   - Supabase auth.users (separate table, untouched).
 *
 * Safety:
 *   - Requires `WIPE_CONFIRM=yes-i-am-sure` in the environment.
 *     Without it, the script logs a refusal and exits 0 — refusing
 *     safely is the intended behavior, not a failure.
 *   - Idempotent — re-running with zero rows exits 0.
 *   - Transactional — all six deletes run inside a single
 *     `prisma.$transaction([...])` so a partial wipe is impossible.
 *   - Refuses to connect to the DB until the env var is validated, so
 *     an accidental invocation never opens a connection.
 *
 * Usage:
 *   WIPE_CONFIRM=yes-i-am-sure npm run wipe:db
 *   npx tsx scripts/wipe-db.ts
 *   (with the env var set in the same shell)
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const WIPE_CONFIRM_VALUE = "yes-i-am-sure";

export type WipeResult = {
  userBet: number;
  betMarket: number;
  groupMember: number;
  group: number;
  match: number;
  competition: number;
};

export async function wipeBettingData(): Promise<WipeResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL not set. Run from project root (loads .env) or set it explicitly.",
    );
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  try {
    const [userBet, betMarket, groupMember, group, match, competition] =
      await prisma.$transaction([
        prisma.userBet.deleteMany({}),
        prisma.betMarket.deleteMany({}),
        prisma.groupMember.deleteMany({}),
        prisma.group.deleteMany({}),
        prisma.match.deleteMany({}),
        prisma.competition.deleteMany({}),
      ]);

    return {
      userBet: userBet.count,
      betMarket: betMarket.count,
      groupMember: groupMember.count,
      group: group.count,
      match: match.count,
      competition: competition.count,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function printReport(r: WipeResult) {
  console.log("Wiped:");
  console.log(`  UserBet:        ${r.userBet}`);
  console.log(`  BetMarket:      ${r.betMarket}`);
  console.log(`  GroupMember:    ${r.groupMember}`);
  console.log(`  Group:          ${r.group}`);
  console.log(`  Match:          ${r.match}`);
  console.log(`  Competition:    ${r.competition}`);
}

async function main() {
  if (process.env.WIPE_CONFIRM !== WIPE_CONFIRM_VALUE) {
    console.log(
      `Refusing to wipe without WIPE_CONFIRM=${WIPE_CONFIRM_VALUE}`,
    );
    process.exit(0);
  }

  const result = await wipeBettingData();
  printReport(result);
  process.exit(0);
}

main().catch((e) => {
  console.error("Wipe failed:", e?.message ?? e);
  process.exit(1);
});
