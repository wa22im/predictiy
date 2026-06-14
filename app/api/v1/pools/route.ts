import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, GuardError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/invite";
import { DEFAULT_SCORING_CONFIG } from "@/lib/scoring/default-config";

/**
 * POST /api/v1/pools
 *
 * Public Create Pool. The endpoint is open to any logged-in user
 * (admin or not) and accepts one of two body shapes:
 *
 *   1. { name, competitionId }
 *        → bind the new pool to an existing competition
 *   2. { name, newCompetition: { name, endDate } }
 *        → create a custom tournament inline (with the caller set
 *          as `createdBy` and the only entry in `editors`), then
 *          bind the pool to it.
 *
 * The XOR is enforced at three layers: the Zod schema (one of the
 * two is required and they cannot both be set), the route's
 * post-validation branch, and the test suite.
 *
 * Auth: `requireAuth()` — any logged-in user. The endpoint does
 * NOT require admin: the principal wants non-admin users to be
 * able to spin up a custom tournament + pool inline when they
 * join the app.
 *
 * Returns 201 with the new group's id, name, competitionId, and
 * the (resolved) competitionName. On the inline-create path, the
 * competitionName is the name from the newCompetition body.
 *
 * The new pool's `Group.details.createdBy` is the caller — the
 * rename endpoint reads that field to enforce creator-only rename.
 * The new competition's `details.editors` is `[caller.id]` — the
 * manage-matches routes read that field to enforce creator-only
 * edit. See `app/api/v1/admin/competitions/[id]/matches/...`.
 */

const CreatePoolBody = z
  .object({
    name: z.string().min(1).max(80),
    competitionId: z.string().min(1).optional(),
    newCompetition: z
      .object({
        name: z.string().min(1).max(120),
        endDate: z.string().datetime(),
      })
      .optional(),
  })
  .refine(
    (data) =>
      (data.competitionId !== undefined) !==
      (data.newCompetition !== undefined),
    {
      message:
        "Provide exactly one of `competitionId` (existing competition) or `newCompetition` (create a custom tournament inline).",
      path: ["competitionId"],
    },
  );

async function handleGuardError(e: unknown) {
  if (e instanceof GuardError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

export async function POST(request: Request) {
  let caller: { id: string; email: string };
  try {
    caller = await requireAuth();
  } catch (e) {
    return handleGuardError(e);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = CreatePoolBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, competitionId, newCompetition } = parsed.data;

  // Resolve the competitionId. Either we got one from the caller
  // (existing path) or we create a custom tournament inline and use
  // its id. The competitionName is returned in the response so the
  // UI can show the user what they just bound to.
  let resolvedCompetitionId: string;
  let resolvedCompetitionName: string | undefined;

  if (newCompetition) {
    // Inline create. The new row is born with externalSource = null
    // so the cron never auto-syncs it. The `details.editors` list is
    // the source of truth for the manage-matches editor check; we
    // seed it with just the caller (the creator). The `createdBy`
    // field is for the human-readable audit trail.
    const created = await prisma.competition.create({
      data: {
        name: newCompetition.name,
        externalSource: null,
        externalLeagueId: null,
        externalSeason: null,
        endDate: new Date(newCompetition.endDate),
        details: {
          createdBy: caller.id,
          editors: [caller.id],
        },
      },
    });
    resolvedCompetitionId = created.id;
    resolvedCompetitionName = created.name;
  } else {
    // Existing path — trust the caller's competitionId. The
    // Competition.competitionId is a UUID; the Zod schema
    // intentionally allows any non-empty string here (no `.uuid()`)
    // because the constraint comes from a downstream query, not
    // from the type system.
    if (!competitionId) {
      // Defensive — the Zod refine ensures this branch is
      // unreachable, but the type system needs the assertion.
      return NextResponse.json(
        { error: "VALIDATION", message: "competitionId is required" },
        { status: 400 },
      );
    }
    resolvedCompetitionId = competitionId;
  }

  // Generate a unique invite code (retry on collision). Mirrors
  // the existing `createGroupAction` flow in
  // `app/(app)/dashboard/actions.ts`.
  let inviteCode = generateInviteCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.group.findUnique({
      where: { inviteCode },
      select: { id: true },
    });
    if (!exists) break;
    inviteCode = generateInviteCode();
  }

  const group = await prisma.group.create({
    data: {
      name,
      competitionId: resolvedCompetitionId,
      inviteCode,
      scoringConfig: DEFAULT_SCORING_CONFIG,
      // Track the creator in JSONB (no schema migration). The
      // rename endpoint reads this to enforce creator-only
      // permission; legacy groups have no createdBy and cannot
      // be renamed until a creator is assigned.
      details: { createdBy: caller.id },
      members: {
        create: {
          userId: caller.id,
        },
      },
    },
  });

  return NextResponse.json(
    {
      id: group.id,
      name: group.name,
      competitionId: group.competitionId,
      competitionName: resolvedCompetitionName,
    },
    { status: 201 },
  );
}
