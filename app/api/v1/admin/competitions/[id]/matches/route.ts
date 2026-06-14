import { NextResponse } from "next/server";
import { requireAuth, GuardError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { AddMatchesInput } from "@/lib/validation/admin";
import { MIN_MS_BEFORE_KICKOFF } from "@/lib/validation/tournament";

/**
 * POST /api/v1/admin/competitions/[id]/matches
 *
 * Add matches to a custom tournament. Body: `{ matchIds: string[] }`.
 *
 * Two new gates since the "public-create-pool / creator-only-edit"
 * round:
 *   1. Editor check — the caller must be in
 *      `Competition.details.editors`. The list is initialised at
 *      tournament creation with `[createdBy]` (see
 *      `app/api/v1/pools/route.ts` and
 *      `app/api/v1/admin/competitions/route.ts`). Returns 403
 *      `NOT_EDITOR` otherwise. The check is custom-tournament-
 *      specific; vendor tournaments have a different (admin-only)
 *      auth model.
 *   2. 1-hour buffer — every matchId must have
 *      `kickoffTime > now + MIN_HOURS_BEFORE_KICKOFF`. Returns
 *      400 `MATCH_TOO_CLOSE` otherwise. The constant is shared
 *      with the UI (the picker in
 *      `components/admin/CustomTournamentMatchManager.tsx` hides
 *      matches inside the buffer so the user doesn't pick a match
 *      the server will reject).
 *
 * Two pre-existing gates retained:
 *   - 404 on missing/soft-deleted competition
 *   - 404 `MATCH_NOT_FOUND` on any bogus matchId
 *   - 400 `MATCH_AFTER_ENDDATE` if any match's kickoffTime is past
 *     the competition's endDate.
 *
 * Implementation: a single `prisma.competitionMatch.createMany` with
 * `skipDuplicates: true` (the join table's primary key is
 * `[matchId, competitionId]`, so a duplicate is a no-op). The
 * match-existence + match-validation query selects `id, kickoffTime,
 * status` so the route can enforce the buffer and endDate rules.
 *
 * Why we still permit historical matches: see the prior block-level
 * comment. A user who's hydrating a hand-built tournament with
 * matches from multiple vendors may need to add already-played
 * matches. The DELETE endpoint enforces the "not yet played" rule
 * (settled bets cannot be retroactively detached); add is
 * intentionally more permissive, gated only by the buffer + endDate.
 *
 * Auth: `requireAuth()` (any logged-in user) + editor check
 * (`editors?.includes(caller.id)`). 401 on unauthenticated,
 * 403 on not-an-editor, 400 on validation/buffer/endDate,
 * 404 on missing competition or any bogus matchId.
 */

async function handleGuardError(e: unknown) {
  if (e instanceof GuardError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let caller: { id: string; email: string };
  try {
    caller = await requireAuth();
  } catch (e) {
    return handleGuardError(e);
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = AddMatchesInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Verify the competition exists (and is not soft-deleted). We
  // also need `details.editors` and `endDate` for the editor check
  // and the endDate gate, respectively.
  const competition = await prisma.competition.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
      endDate: true,
      // The route treats the editor check as a custom-tournament
      // rule. For vendor tournaments (externalSource !== null)
      // the editors list may be absent — the access control for
      // those is admin-only upstream, so we don't need to enforce
      // it here. We still read `details` so the check works
      // uniformly; the check is a no-op for an empty/missing list.
      details: true,
    },
  });
  if (!competition || competition.deletedAt) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // EDITOR CHECK — only the creator (and future co-editors) of a
  // custom tournament can add matches. The check is
  // `editors?.includes(caller.id) ?? false`, which falls back to
  // "no access" if the `editors` field is missing (legacy
  // tournaments created before this round).
  const editors = Array.isArray(
    (competition.details as { editors?: unknown } | null)?.editors,
  )
    ? ((competition.details as { editors: string[] }).editors)
    : [];
  if (!editors.includes(caller.id)) {
    return NextResponse.json({ error: "NOT_EDITOR" }, { status: 403 });
  }

  // Verify every matchId exists AND load its kickoffTime + status
  // for the 1-hour buffer + endDate gates. We dedupe input first
  // so the count comparison below is honest.
  const uniqueIds = Array.from(new Set(parsed.data.matchIds));
  const existing = await prisma.match.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, kickoffTime: true, status: true },
  });
  const existingIds = new Set(existing.map((m) => m.id));
  const missing = uniqueIds.filter((mid) => !existingIds.has(mid));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "MATCH_NOT_FOUND",
        message: `Match(es) not found: ${missing.join(", ")}`,
      },
      { status: 404 },
    );
  }

  // 1-hour buffer: reject matches whose kickoffTime is within
  // MIN_HOURS_BEFORE_KICKOFF of now. The boundary is "strictly
  // less than" — a match with kickoffTime === now + 1h is
  // rejected. We compute `cutoff = now + MIN_MS_BEFORE_KICKOFF`
  // and require `kickoffTime > cutoff`. A match that's already
  // past kickoff is also rejected (kickoffTime <= now).
  const now = new Date();
  const cutoff = new Date(now.getTime() + MIN_MS_BEFORE_KICKOFF);
  const tooClose = existing.find((m) => m.kickoffTime.getTime() <= cutoff.getTime());
  if (tooClose) {
    return NextResponse.json(
      {
        error: "MATCH_TOO_CLOSE",
        message: `Match ${tooClose.id} is within ${Math.round(MIN_MS_BEFORE_KICKOFF / 60000)} minutes of kickoff.`,
      },
      { status: 400 },
    );
  }

  // endDate gate: if the competition has an endDate set, reject
  // matches whose kickoffTime is past it. The competition's
  // endDate is required for custom tournaments (DB CHECK
  // constraint) and may be null for vendor tournaments — in which
  // case the gate is a no-op.
  if (competition.endDate) {
    const past = existing.find(
      (m) => m.kickoffTime.getTime() > competition.endDate!.getTime(),
    );
    if (past) {
      return NextResponse.json(
        {
          error: "MATCH_AFTER_ENDDATE",
          message: `Match ${past.id} is scheduled after the tournament's end date.`,
        },
        { status: 400 },
      );
    }
  }

  // createMany with skipDuplicates. `count` reflects rows actually
  // inserted (duplicates are silently skipped) — that's the
  // operationally useful number for the admin.
  const result = await prisma.competitionMatch.createMany({
    data: uniqueIds.map((matchId) => ({ matchId, competitionId: id })),
    skipDuplicates: true,
  });

  return NextResponse.json(
    { added: result.count, requested: uniqueIds.length },
    { status: 200 },
  );
}
