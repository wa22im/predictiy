import { Volleyball } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CreatePoolButton } from "@/components/groups/CreatePoolButton";
import { EnterCodeForm } from "@/components/groups/EnterCodeForm";
import { PitchBg } from "@/components/football";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { getDashboardData } from "@/lib/services/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null; // Handled by middleware usually

  const [dashboard, competitions] = await Promise.all([
    getDashboardData(user.id),
    prisma.competition.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const hasActiveGroups = dashboard.groups.length > 0;

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <p className="micro-tag mb-3">Your Cockpit</p>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-4">
            <h1 className="font-display text-5xl md:text-6xl tracking-tight inline-flex items-center gap-3">
              <Volleyball
                aria-hidden="true"
                className="h-10 w-10 sm:h-12 sm:w-12 text-accent shrink-0"
              />
              Predictyy
            </h1>
          
          </div>
          <p className="text-muted-foreground leading-7 mb-6">
            The groups you&apos;re in. Predict, compete, win.
          </p>

          {/* Header actions: side-by-side CreatePool + EnterCode */}
          <div className="pitch-card-fut p-2 sm:p-3 mb-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <CreatePoolButton competitions={competitions} variant="card" />
              </div>
              <div className="flex-1">
                <EnterCodeForm />
              </div>
            </div>
          </div>

          {hasActiveGroups ? (
            <DashboardTabs
              groups={dashboard.groups}
              serverNow={dashboard.serverNow}
              lockdownMs={dashboard.lockdownMs}
            />
          ) : (
            <div className="pitch-card-hero p-10 text-center max-w-md mx-auto">
              <Volleyball
                aria-hidden="true"
                className="h-12 w-12 text-primary mx-auto mb-3"
              />
              <p className="font-display text-2xl tracking-tight mb-2">
                You aren&apos;t in any pools yet!
              </p>
              <p className="text-muted-foreground text-sm leading-6">
                Create a tournament pool or enter an invite code to start competing with friends.
              </p>
            </div>
          )}
        </div>
      </main>
    </PitchBg>
  );
}
