import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listCompetitions, FootballDataError } from "@/lib/services/football-data";
import { DiscoverCompetitionsList } from "@/components/admin/DiscoverCompetitionsList";
import type { Competition } from "@/lib/services/football-data";

export const dynamic = "force-dynamic";

export default async function DiscoverCompetitionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const hasToken = !!process.env.FOOTBALL_DATA_TOKEN;

  let competitions: Competition[] = [];
  let errorMessage: string | null = null;
  if (hasToken) {
    try {
      competitions = await listCompetitions();
    } catch (e) {
      errorMessage =
        e instanceof FootballDataError ? e.message : (e as Error).message;
    }
  }

  // Build the area options once on the server for the client filter.
  const areas = Array.from(
    new Map(
      competitions.map((c) => [
        c.area.id,
        { id: c.area.id, name: c.area.name, code: c.area.code },
      ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="planner-bg min-h-screen flex-1 px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <a
          href="/admin/leagues"
          className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
        >
          ← Back to leagues
        </a>
        <p className="micro-label mb-2">External Sources</p>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-2">
          Discover Competitions
        </h1>
        <p className="text-muted-foreground leading-7 mb-8">
          Browse the football-data.org catalogue and onboard a competition
          with a single click. The provider's match ids are preserved so
          future syncs can update existing rows in place.
        </p>

        {!hasToken && (
          <div className="paper-card p-4 mb-6 border-destructive/40">
            <p className="text-sm">
              <span className="font-medium text-destructive">
                FOOTBALL_DATA_TOKEN not set.
              </span>{" "}
              Get a free token at{" "}
              <a
                className="underline"
                href="https://www.football-data.org/"
                target="_blank"
                rel="noreferrer"
              >
                football-data.org
              </a>{" "}
              (email registration required), then add it to{" "}
              <code className="font-mono">.env.local</code> as{" "}
              <code className="font-mono">FOOTBALL_DATA_TOKEN=…</code> and
              restart the dev server.
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="paper-card p-4 mb-6 border-destructive/40">
            <p className="text-sm text-destructive">
              <span className="font-medium">Failed to load competitions:</span>{" "}
              {errorMessage}
            </p>
          </div>
        )}

        {hasToken && !errorMessage && competitions.length > 0 && (
          <DiscoverCompetitionsList competitions={competitions} areas={areas} />
        )}

        {hasToken && !errorMessage && competitions.length === 0 && (
          <div className="glass-panel p-8 text-center">
            <p className="text-muted-foreground text-sm">
              No competitions returned by football-data.org.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
