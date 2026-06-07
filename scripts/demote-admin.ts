/**
 * Demote a user from admin by email.
 *
 * Usage:
 *   npm run admin:demote <email>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Run from project root or set it explicitly.");
    process.exit(1);
  }

  const adapter = new PrismaPg(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  const email = process.argv[2] || process.env.DEV_ADMIN_EMAIL;
  if (!email) {
    console.error("Provide an email: npm run admin:demote <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}.`);
    process.exit(1);
  }

  if (!user.isAdmin) {
    console.log(`${email} is not an admin.`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: false },
  });

  console.log(`✅ ${email} demoted.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
