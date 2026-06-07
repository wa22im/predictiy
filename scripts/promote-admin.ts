/**
 * Promote a user to admin by email.
 *
 * Usage:
 *   npm run setadmin <email>
 *   npm run admin:promote <email>
 *   npx tsx scripts/promote-admin.ts <email>
 *   DEV_ADMIN_EMAIL=you@example.com npm run setadmin
 *
 * The auth sync trigger on User.isAdmin mirrors the flag to
 * auth.users.raw_user_meta_data so the middleware can pre-filter
 * admin routes. NOTE: requires .env to be loaded (DATABASE_URL);
 * the npm script auto-loads it via dotenv-cli or by running from
 * the project root.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Run from project root (loads .env) or set it explicitly.");
    process.exit(1);
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  const email = process.argv[2] || process.env.DEV_ADMIN_EMAIL;
  if (!email) {
    console.error("Provide an email: npm run setadmin <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}. Sign in once first to create the row.`);
    process.exit(1);
  }

  if (user.isAdmin) {
    console.log(`${email} is already an admin.`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: true },
  });

  console.log(`✅ ${email} promoted to admin. Auth metadata will sync via trigger.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
