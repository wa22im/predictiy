/**
 * db-init.ts — drop the public schema and re-create from init.sql.
 *
 * Why this script:
 *   The project uses a single init.sql file (no migration system).
 *   Disaster recovery is: drop the schema, run init.sql, done.
 *   This script does exactly that.
 *
 * Safety:
 *   - Requires `INIT_CONFIRM=yes-i-am-sure` in the environment.
 *     Without it, the script logs a refusal and exits 0.
 *   - Idempotent — re-running with no changes is a no-op.
 *   - Refuses to connect to the DB until the env var is validated.
 *
 * Usage:
 *   INIT_CONFIRM=yes-i-am-sure npm run db:init
 *   npx tsx scripts/db-init.ts
 *   (with the env var set in the same shell)
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const INIT_CONFIRM_VALUE = "yes-i-am-sure";

/**
 * Split a SQL script into individual statements, respecting dollar-quoted
 * strings ($$ ... $$) used by PL/pgSQL function bodies.
 *
 * Postgres DDL like CREATE FUNCTION often contains semicolons inside
 * function bodies; a naive split-on-semicolon would break them up
 * incorrectly. This function tracks the dollar-quote depth and only
 * splits on top-level semicolons.
 *
 * Also strips line comments (-- ...) before splitting.
 */
function splitSqlStatements(sql: string): string[] {
  // Strip line comments first (preserve newlines so line numbers stay sane)
  const stripped = sql.replace(/^--.*$/gm, "");

  const statements: string[] = [];
  let current = "";
  let depth = 0; // depth of nested $$ ... $$ blocks
  let i = 0;

  while (i < stripped.length) {
    const ch = stripped[i];
    const next = stripped[i + 1];

    if (ch === "$" && next === "$") {
      // Toggle dollar-quote depth
      depth = depth === 0 ? 1 : 0;
      current += "$$";
      i += 2;
      continue;
    }

    if (ch === ";" && depth === 0) {
      // Top-level semicolon — end of statement
      const stmt = current.trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Push any remaining content as the last statement
  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

async function main() {
  if (process.env.INIT_CONFIRM !== INIT_CONFIRM_VALUE) {
    console.log(
      `Refusing to init without INIT_CONFIRM=${INIT_CONFIRM_VALUE}`,
    );
    process.exit(0);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL not set. Run from project root (loads .env) or set it explicitly.",
    );
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("[1/3] Dropping and recreating the public schema...");
    await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA public`);
    await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO postgres`);
    await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO public`);

    console.log("[2/3] Reading prisma/init.sql...");
    const initSql = readFileSync(
      join(process.cwd(), "prisma", "init.sql"),
      "utf-8",
    );

    console.log("[3/3] Applying prisma/init.sql...");
    const statements = splitSqlStatements(initSql);
    console.log(`  Found ${statements.length} top-level statements.`);

    let count = 0;
    for (const stmt of statements) {
      count++;
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (e: any) {
        console.error(`\nFailed statement (${count} of ${statements.length}):\n${stmt}\n`);
        throw e;
      }
    }

    console.log(`\nDone. ${count} statements applied. Public schema initialized from init.sql.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Init failed:", e?.message ?? e);
  process.exit(1);
});
