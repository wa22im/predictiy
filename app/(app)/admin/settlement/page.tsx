import { prisma } from "@/lib/prisma";
import { SettlementForm } from "@/components/admin/SettlementForm";

export default async function SettlementPage() {
  const unsettled = await prisma.betMarket.findMany({
    where: { isSettled: false },
    include: {
      match: {
        include: { competition: { select: { name: true } } },
      },
    },
    orderBy: [{ match: { kickoffTime: "asc" } }, { title: "asc" }],
  });

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-3xl mx-auto">
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
          Settle completed matches and outright markets. Scoring runs across
          every group participating in the competition.
        </p>

        <SettlementForm
          unsettled={unsettled.map((m) => ({
            id: m.id,
            type: m.type,
            title: m.title,
            options: (m.options as string[] | null) ?? null,
            match: m.match
              ? {
                  id: m.match.id,
                  homeTeam: m.match.homeTeam,
                  awayTeam: m.match.awayTeam,
                  kickoffTime: m.match.kickoffTime.toISOString(),
                  stage: m.match.stage,
                  competitionName: m.match.competition.name,
                }
              : null,
          }))}
        />
      </div>
    </main>
  );
}
