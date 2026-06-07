/**
 * Promote a user to admin by email.
 *
 * Usage:
 *   DEV_ADMIN_EMAIL=you@example.com npx tsx scripts/promote-admin.ts
 *
 * Or pass email as the first argument:
 *   npx tsx scripts/promote-admin.ts you@example.com
 *
 * The auth sync trigger on User.isAdmin will mirror the flag to
 * auth.users.raw_user_meta_data so the middleware can pre-filter
 * admin routes.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email =
    process.argv[2] ||
    process.env.DEV_ADMIN_EMAIL;

  if (!email) {
    console.error("Provide an email: npx tsx scripts/promote-admin.ts <email>");
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
