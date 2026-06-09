import { redirect } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CreatePoolButton } from "@/components/groups/CreatePoolButton";
import { EnterCodeForm } from "@/components/groups/EnterCodeForm";
import { PitchBg } from "@/components/football";

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
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <p className="micro-tag mb-3">Your Cockpit</p>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-4">
            <h1 className="font-display text-5xl md:text-6xl tracking-tight">
              Predictyy
            </h1>
            <CreatePoolButton competitions={competitions} />
          </div>
          <p className="text-muted-foreground leading-7 mb-6">
            The groups you&apos;re in. Predict, compete, win.
          </p>
          <div className="mb-12">
            <EnterCodeForm />
          </div>

          {memberships.length === 0 ? (
            <div className="pitch-card-hero p-10 text-center max-w-md mx-auto">
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
                  className="pitch-card-fut p-6 hover:-translate-y-0.5 transition-transform"
                >
                  <p className="micro-tag mb-2 inline-flex items-center gap-2">
                    <Trophy aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
                    {group.competition.name}
                  </p>
                  <h2 className="font-display text-2xl font-bold tracking-tight mb-2">
                    {group.name}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {group._count.members}{" "}
                    {group._count.members === 1 ? "member" : "members"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </PitchBg>
  );
}
