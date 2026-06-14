import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CustomTournamentMatchManager } from "@/components/admin/CustomTournamentMatchManager";
import { PitchBg } from "@/components/football";

/**
 * Public (authenticated) page: manage the matches belonging to a
 * custom (manual) tournament. Two responsibilities:
 *
 *   1. List the matches currently linked to this competition via the
 *      `CompetitionMatch` join table (the m2m source of truth), with
 *      a "Remove" button per row.
 *   2. Provide an "Add matches" affordance that opens a modal with a
 *      competition picker — so any logged-in user can pull in matches
 *      from any other competition (vendor or custom).
 *
 * Auth: this page lives OUTSIDE the `(app)/admin` tree, so it does
 * NOT go through `requireAdmin()` / the admin layout gate. Any
 * authenticated user can curate a custom tournament's match list.
 * The `(app)/admin` admin-only restriction still applies to
 * creating a custom tournament — see `POST /api/v1/admin/competitions`
 * (which keeps `requireAdmin()`).
 *
 * History: the page previously lived at `/admin/tournaments/[id]/matches`
 * and was admin-gated. As of the "manage-matches-public" round it
 * was moved here. The old path now 404s — no backward-compat
 * redirect stub was kept (the legacy admin page was deleted; the
 * admin layout would have blocked non-admin users from reaching a
 * redirect anyway, so a redirect at that path would have only
 * helped admin users who would reach the new page via the new
 * `/tournaments/...` link in `/admin/leagues` regardless).
 *
 * The list is rendered through `<CustomTournamentMatchManager>`,
 * which is a client component that owns the add/remove UI and the
 * "Add matches" modal.
 */

export const dynamic = "force-dynamic";

export default async function ManageTournamentMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  if (!id) redirect("/tournaments");

  const competition = await prisma.competition.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      externalSource: true,
      deletedAt: true,
      // endDate is needed by the "Add matches" filter so the
      // modal hides matches scheduled past the tournament's
      // end date (the server's MATCH_AFTER_ENDDATE gate). For
      // vendor tournaments this may be null — the filter is a
      // no-op in that case.
      endDate: true,
    },
  });
  if (!competition || competition.deletedAt) {
    // A deleted tournament's match list is not a meaningful view.
    // Send non-admin users to the dashboard; the admin leagues page
    // is gated, so we don't redirect there from a public page.
    redirect("/dashboard");
  }

  // Current matches: follow the m2m join so the list matches what the
  // POST/DELETE endpoints actually mutate. Sorting by kickoffTime ASC
  // keeps the natural "next match first" order — useful when the
  // user is pruning already-played or soon-to-be-played matches.
  const matches = await prisma.match.findMany({
    where: { customLinks: { some: { competitionId: id } } },
    orderBy: { kickoffTime: "asc" },
    select: {
      id: true,
      homeTeam: true,
      awayTeam: true,
      kickoffTime: true,
      status: true,
      homeCrest: true,
      awayCrest: true,
    },
  });

  // Pool of competitions the user can pull matches FROM. We exclude
  // soft-deleted tournaments and the current competition (you can't
  // "add" a match that's already in the tournament). Vendor and
  // custom competitions are both allowed — the modal's step-2
  // dropdown is just a navigation aid.
  const sourceCompetitions = await prisma.competition.findMany({
    where: {
      deletedAt: null,
      id: { not: id },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      externalSource: true,
    },
  });

  // Pre-fetch matches for every source competition. The modal's
  // step-2 view shows the matches for the chosen source competition;
  // shipping the lists in one go avoids a round-trip and keeps the
  // UX snappy. The principal's user base is small (max 10
  // tournaments per the AGENTS.md), so the total match count is
  // bounded. We only need the fields the modal renders: teams,
  // kickoff, status, crests.
  const sourceCompetitionIds = sourceCompetitions.map((c) => c.id);
  const sourceMatches =
    sourceCompetitionIds.length > 0
      ? await prisma.match.findMany({
          where: { competitionId: { in: sourceCompetitionIds } },
          orderBy: { kickoffTime: "asc" },
          select: {
            id: true,
            homeTeam: true,
            awayTeam: true,
            kickoffTime: true,
            status: true,
            homeCrest: true,
            awayCrest: true,
            competitionId: true,
          },
        })
      : [];

  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <a
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
          >
            ← Back to dashboard
          </a>
          <p className="micro-tag mb-2">Manage Matches</p>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight mb-2">
            {competition.name}
          </h1>
          <p className="text-muted-foreground text-sm leading-7 mb-8">
            {matches.length} match{matches.length === 1 ? "" : "es"} in this
            custom tournament. Add matches from any other competition, or
            remove matches that haven&apos;t been played yet.
          </p>

          <CustomTournamentMatchManager
            competitionId={competition.id}
            competitionEndDate={competition.endDate ? competition.endDate.toISOString() : null}
            initialMatches={matches.map((m) => ({
              id: m.id,
              homeTeam: m.homeTeam,
              awayTeam: m.awayTeam,
              kickoffTime: m.kickoffTime.toISOString(),
              status: m.status,
              homeCrest: m.homeCrest,
              awayCrest: m.awayCrest,
            }))}
            sourceCompetitions={sourceCompetitions.map((c) => ({
              id: c.id,
              name: c.name,
              externalSource: c.externalSource,
            }))}
            sourceMatches={sourceMatches.map((m) => ({
              id: m.id,
              competitionId: m.competitionId,
              homeTeam: m.homeTeam,
              awayTeam: m.awayTeam,
              kickoffTime: m.kickoffTime.toISOString(),
              status: m.status,
              homeCrest: m.homeCrest,
              awayCrest: m.awayCrest,
            }))}
          />
        </div>
      </main>
    </PitchBg>
  );
}
