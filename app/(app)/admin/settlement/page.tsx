import { prisma } from "@/lib/prisma";
import {
  SettlementTournamentSection,
  type SettlementTournamentSectionProps,
} from "@/components/admin/SettlementTournamentSection";
import type { SettlementMatchFormInitial } from "@/components/admin/SettlementMatchForm";

export const dynamic = "force-dynamic";

export default async function SettlementPage() {
  // Fetch every competition with its matches + the markets needed to
  // compute the "Locked — auto-settled" badge. We sort at the DB
  // level (kickoffTime ASC) for a deterministic response and let the
  // client component re-sort if it needs to.
  const competitions = await prisma.competition.findMany({
    orderBy: { name: "asc" },
    include: {
      matches: {
        orderBy: { kickoffTime: "asc" },
        include: {
          markets: { select: { isSettled: true } },
        },
      },
    },
  });

  const sections: SettlementTournamentSectionProps[] = competitions
    .filter((c) => c.matches.length > 0)
    .map((c) => ({
      competitionId: c.id,
      competitionName: c.name,
      matches: c.matches.map<SettlementMatchFormInitial>((m) => ({
        id: m.id,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffTime: m.kickoffTime.toISOString(),
        stage: m.stage,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        homeHtGoals: m.homeHtGoals,
        awayHtGoals: m.awayHtGoals,
        homePenalties: m.homePenalties,
        awayPenalties: m.awayPenalties,
        hasSettledMarkets: m.markets.some((mk) => mk.isSettled),
      })),
    }));

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <a
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to admin
        </a>
        <p className="micro-label mb-2">Operational Control Room</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-4">
          Settlement Hub
        </h1>
        <p className="text-muted-foreground leading-7 mb-8">
          Record final scores, half-time goals, and in-game penalties. When a
          match transitions to FINISHED, the three default markets are
          auto-settled.
        </p>

        {sections.length === 0 ? (
          <div className="glass-panel p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No matches yet. Onboard a competition first.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {sections.map((s) => (
              <SettlementTournamentSection key={s.competitionId} {...s} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
