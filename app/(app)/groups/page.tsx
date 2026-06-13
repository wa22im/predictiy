import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Crown, Swords } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { CreatePoolButton } from "@/components/groups/CreatePoolButton";
import { PitchBg } from "@/components/football";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
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

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
            <h1 className="font-display text-4xl sm:text-5xl tracking-tight">
              Your Groups
            </h1>
          </div>

            <div className="text-center">
              <CreatePoolButton competitions={[]} />
            </div>
          
            <div className="space-y-3">
              {memberships.map((m) => {
                const memberCount = m.group._count.members;
                return (
                  <Link
                    key={m.group.id}
                    href={`/groups/${m.group.id}`}
                    className="pitch-card p-4 hover:-translate-y-0.5 transition-transform block"
                  >
                    <p className="font-display text-xl font-bold">
                      {m.group.name}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Crown
                      color="yellow"
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-accent"
                      />
                      {m.group.competition.name}
                     <Crown
                      color="yellow"
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-accent"
                      />
                    </p>
                    
                    <p className="text-xs text-muted-foreground mt-1">
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </p>
                  </Link>
                );
              })}
            </div>
          
        </div>
      </main>
    </PitchBg>
  );
}
