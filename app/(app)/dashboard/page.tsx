import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CreatePoolButton } from "@/components/groups/CreatePoolButton";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    include: {
      group: {
        include: {
          competition: { select: { name: true } },
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  const competitions = await prisma.competition.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <p className="micro-label mb-3">Your Cockpit</p>
        <h1 className="font-display text-5xl md:text-6xl tracking-tight mb-4">
          Pools
        </h1>
        <p className="text-muted-foreground leading-7 mb-12">
          The groups you&apos;re in. Predict, compete, win.
        </p>

        {memberships.length === 0 ? (
          <div className="glass-panel p-10 text-center max-w-md mx-auto">
            <p className="font-display text-2xl tracking-tight mb-2">
              You aren&apos;t in any pools yet!
            </p>
            <p className="text-muted-foreground text-sm leading-6 mb-6">
              Create a tournament pool to start competing with friends.
            </p>
            <CreatePoolButton competitions={competitions} />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {memberships.map(({ group }) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="paper-card p-6 hover:-translate-y-0.5 transition-transform"
              >
                <p className="micro-label mb-2">{group.competition.name}</p>
                <h2 className="font-display text-2xl font-bold tracking-tight mb-2">
                  {group.name}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {group._count.members}{" "}
                  {group._count.members === 1 ? "member" : "members"}
                </p>
              </Link>
            ))}
            <CreatePoolButton variant="card" competitions={competitions} />
          </div>
        )}
      </div>
    </main>
  );
}
