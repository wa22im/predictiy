/**
 * Dev helper: shift all match kickoff times by a relative offset so you
 * can exercise the countdown UI without manual SQL.
 *
 * Usage:
 *   npm run dev:shift -- 2h          # all matches: now+2h
 *   npm run dev:shift -- -5m         # all matches: now-5min (already locked)
 *   npm run dev:shift -- 30m 90m     # spread across now+30m..now+90m
 *
 * Resets (back to seed defaults):
 *   npm run dev:reset-times
 *
 * Reads the original times from the seed JSON; only mutates kickoffTime
 * so all other match data is preserved.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function parseOffset(s: string): number {
  const m = /^(-?\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i.exec(s.trim());
  if (!m) throw new Error(`Bad offset: ${s}. Use 2h, 30m, 90s, 1d, etc.`);
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "m").toLowerCase();
  const ms = unit === "s" ? 1_000
    : unit === "m" ? 60_000
    : unit === "h" ? 3_600_000
    : 86_400_000;
  return n * ms;
}

async function shift(args: string[]) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Run from project root.");
    process.exit(1);
  }
  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  const now = Date.now();
  const isMulti = args.length > 1;
  const matches = await prisma.match.findMany({ orderBy: { kickoffTime: "asc" } });
  if (matches.length === 0) {
    console.log("No matches in DB. Run npm run db:seed first.");
    return;
  }

  if (isMulti) {
    // Distribute matches across [args[0], args[1]] from now
    const start = now + parseOffset(args[0]);
    const end = now + parseOffset(args[1]);
    const step = matches.length > 1 ? (end - start) / (matches.length - 1) : 0;
    for (let i = 0; i < matches.length; i++) {
      const newTime = new Date(start + step * i);
      await prisma.match.update({
        where: { id: matches[i].id },
        data: { kickoffTime: newTime },
      });
      const diffHr = (newTime.getTime() - now) / 3_600_000;
      console.log(`  ${matches[i].homeTeam} vs ${matches[i].awayTeam} → ${newTime.toISOString()} (in ${diffHr.toFixed(1)}h)`);
    }
    console.log(`\n✅ ${matches.length} matches distributed between ${args[0]} and ${args[1]}`);
  } else if (args[0] === "reset") {
    // Restore from seed JSON
    const fixture = JSON.parse(
      readFileSync(resolve(process.cwd(), "prisma/seed/fixtures/wc-2026-group-stage.json"), "utf-8"),
    );
    for (const m of fixture.matches) {
      await prisma.match.update({
        where: { apiMatchId: m.apiMatchId },
        data: { kickoffTime: new Date(m.kickoffTime) },
      });
      console.log(`  ${m.homeTeam} vs ${m.awayTeam} → ${m.kickoffTime}`);
    }
    console.log(`\n✅ Matches reset to seed JSON defaults`);
  } else {
    // Single offset: all matches at now + offset
    const offset = parseOffset(args[0]);
    const newTime = new Date(now + offset);
    for (const m of matches) {
      await prisma.match.update({
        where: { id: m.id },
        data: { kickoffTime: newTime },
      });
    }
    const diffHr = offset / 3_600_000;
    console.log(`✅ All ${matches.length} matches set to ${newTime.toISOString()} (in ${diffHr.toFixed(1)}h)`);
  }
  await prisma.$disconnect();
}

shift(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
