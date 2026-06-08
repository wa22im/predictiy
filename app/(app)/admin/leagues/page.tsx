import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SyncCompetitionButton } from "@/components/admin/SyncCompetitionButton";

export const dynamic = "force-dynamic";

export default async function AdminLeaguesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const competitions = await prisma.competition.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { matches: true, groups: true } },
    },
  });

  const onboarded = competitions.filter((c) => c.externalSource !== null);
  const manual = competitions.filter((c) => c.externalSource === null);

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <a
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to admin
        </a>
        <p className="micro-label mb-2">External Sources</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
          League Roster
        </h1>
        <p className="text-muted-foreground leading-7 mb-8">
          Onboard tournaments from api-football.com. New games appear
          automatically in every group for that competition. The cron
          syncs every 5 minutes and auto-settles finished matches.
        </p>

        <div className="mb-6 flex justify-end">
          <a
            href="/admin/leagues/new"
            className="command-strip px-4 py-2 text-sm font-bold"
          >
            + Onboard league
          </a>
        </div>

        <section className="mb-10">
          <h2 className="font-display text-xl font-bold tracking-tight mb-3">
            Onboarded (auto-syncing)
          </h2>
          {onboarded.length === 0 ? (
            <div className="glass-panel p-8 text-center">
              <p className="text-muted-foreground text-sm">
                No leagues onboarded yet. Click "Onboard league" to get started.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {onboarded.map((c) => (
                <li key={c.id} className="paper-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {c.externalSource} · league={c.externalLeagueId} · season={c.externalSeason}
                      </p>
                    </div>
                    <SyncCompetitionButton competitionId={c.id} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {c._count.matches} match{c._count.matches === 1 ? "" : "es"} ·{" "}
                      {c._count.groups} group{c._count.groups === 1 ? "" : "s"}
                    </span>
                    <span>
                      {c.lastSyncedAt
                        ? `Last sync: ${new Date(c.lastSyncedAt).toLocaleString()}`
                        : "Never synced"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {manual.length > 0 && (
          <section>
            <h2 className="font-display text-xl font-bold tracking-tight mb-3">
              Manual (JSON-paste only)
            </h2>
            <ul className="space-y-2">
              {manual.map((c) => (
                <li key={c.id} className="paper-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c._count.matches} match{c._count.matches === 1 ? "" : "es"} ·{" "}
                        {c._count.groups} group{c._count.groups === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                      static
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
