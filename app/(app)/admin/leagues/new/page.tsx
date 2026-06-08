import { LeagueSearchForm } from "@/components/admin/LeagueSearchForm";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewLeaguePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Surface which competitions are already onboarded so the admin
  // doesn't try to add the same league twice.
  const existing = await prisma.competition.findMany({
    where: { externalSource: "api-football" },
    select: { externalLeagueId: true, externalSeason: true, name: true },
  });
  const taken = new Set(
    existing
      .filter((e) => e.externalLeagueId && e.externalSeason)
      .map((e) => `${e.externalLeagueId}:${e.externalSeason}`),
  );

  const hasApiKey = !!process.env.API_FOOTBALL_KEY;

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <a
          href="/admin/leagues"
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to leagues
        </a>
        <p className="micro-label mb-2">External Sources</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
          Onboard League
        </h1>
        <p className="text-muted-foreground leading-7 mb-8">
          Search api-football.com for a league + season. Ingesting
          fetches every fixture and creates a default EXACT_SCORE
          market for each match.
        </p>

        {!hasApiKey && (
          <div className="paper-card p-4 mb-6 border-destructive/40">
            <p className="text-sm">
              <span className="font-medium text-destructive">
                API_FOOTBALL_KEY not set.
              </span>{" "}
              Add it to <code className="font-mono">.env.local</code> and
              restart the dev server. Get a free key at{" "}
              <a
                className="underline"
                href="https://www.api-football.com"
                target="_blank"
                rel="noreferrer"
              >
                api-football.com
              </a>
              .
            </p>
          </div>
        )}

        <LeagueSearchForm takenKeys={[...taken]} />
      </div>
    </main>
  );
}
