import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SyncCompetitionButton } from "@/components/admin/SyncCompetitionButton";
import { EditCompetitionButton } from "@/components/admin/EditCompetitionButton";
import { DeleteCompetitionButton } from "@/components/admin/DeleteCompetitionButton";
import { CreateCustomTournamentButton } from "@/components/admin/CreateCustomTournamentButton";
import { PitchBg } from "@/components/football";

export const dynamic = "force-dynamic";

export default async function AdminLeaguesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Soft-deleted tournaments (deletedAt != null) are excluded from
  // this listing. The DELETE endpoint sets deletedAt; an admin can
  // un-delete by clearing the column directly in the DB. The filter
  // is explicit (vs. a Prisma extension) for now — the
  // Competition table is small (we're pre-launch with a handful of
  // seeded rows) and the explicit `where` keeps every read site
  // visible. A code comment is left in sync-football-data-competition.ts
  // and onboard-competition.ts to note that the same filter should
  // be applied in any new read paths.
  const competitions = await prisma.competition.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { matches: true, groups: true } },
    },
  });

  const onboarded = competitions.filter((c) => c.externalSource !== null);
  const manual = competitions.filter((c) => c.externalSource === null);

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <a
            href="/admin"
            className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
          >
            ← Back to admin
          </a>
          <p className="micro-tag mb-2">External Sources</p>
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
              href="/admin/leagues/discover"
              className="neon-button px-4 py-2 text-sm font-bold"
            >
              + Onboard competition
            </a>
          </div>

          <section className="mb-10">
            <h2 className="font-display text-xl font-bold tracking-tight mb-3">
              Onboarded (auto-syncing)
            </h2>
            {onboarded.length === 0 ? (
              <div className="pitch-card-hero p-8 text-center">
                <p className="text-muted-foreground text-sm">
                  No competitions onboarded yet. Click &quot;Onboard
                  competition&quot; to get started.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {onboarded.map((c) => (
                  <li key={c.id} className="pitch-card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {c.externalSource} · league={c.externalLeagueId} ·{" "}
                          season={c.externalSeason}
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <SyncCompetitionButton
                          competitionId={c.id}
                          externalSource={c.externalSource ?? "unknown"}
                        />
                        <EditCompetitionButton
                          competition={{
                            id: c.id,
                            name: c.name,
                            endDate: c.endDate ? c.endDate.toISOString() : null,
                            externalLeagueId: c.externalLeagueId,
                            externalSeason: c.externalSeason,
                            details: (c.details as Record<string, unknown> | null) ?? null,
                            externalSource: c.externalSource,
                          }}
                        />
                        <DeleteCompetitionButton
                          competitionId={c.id}
                          competitionName={c.name}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {c._count.matches} match
                        {c._count.matches === 1 ? "" : "es"} ·{" "}
                        {c._count.groups} group
                        {c._count.groups === 1 ? "" : "s"}
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

          <section>
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h2 className="font-display text-xl font-bold tracking-tight">
                Manual (custom tournaments)
              </h2>
              <CreateCustomTournamentButton />
            </div>
            {manual.length === 0 ? (
              <div className="pitch-card-hero p-8 text-center">
                <p className="text-muted-foreground text-sm">
                  No custom tournaments yet. Click &quot;Create custom
                  tournament&quot; to make one.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Custom tournaments aggregate matches from any vendor
                  competition. The end date is set at creation and cannot
                  be changed later.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {manual.map((c) => (
                  <li key={c.id} className="pitch-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c._count.matches} match
                          {c._count.matches === 1 ? "" : "es"} ·{" "}
                          {c._count.groups} group
                          {c._count.groups === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <a
                          href={`/tournaments/${c.id}/matches`}
                          className="px-3 py-1 text-xs font-bold border border-muted-foreground/30 text-foreground hover:bg-muted rounded"
                          data-testid="manage-matches-link"
                        >
                          Manage matches
                        </a>
                        <EditCompetitionButton
                          competition={{
                            id: c.id,
                            name: c.name,
                            endDate: c.endDate ? c.endDate.toISOString() : null,
                            externalLeagueId: c.externalLeagueId,
                            externalSeason: c.externalSeason,
                            details: (c.details as Record<string, unknown> | null) ?? null,
                            externalSource: c.externalSource,
                          }}
                        />
                        <DeleteCompetitionButton
                          competitionId={c.id}
                          competitionName={c.name}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </PitchBg>
  );
}
