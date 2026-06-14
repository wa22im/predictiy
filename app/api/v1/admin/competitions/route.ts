import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { CreateCustomCompetitionInput } from "@/lib/validation/admin";

/**
 * POST /api/v1/admin/competitions
 *
 * Create a custom (hand-built) tournament. The new competition is
 * born with `externalSource = null`, `externalLeagueId = null`,
 * `externalSeason = null` so the cron at
 * `app/api/v1/cron/sync/route.ts` never tries to auto-sync it. The
 * admin populates the tournament's match list via the new
 * `POST /api/v1/admin/competitions/[id]/matches` endpoint (which
 * writes to the `CompetitionMatch` join table).
 *
 * Why this exists: mixed tournaments (matches from multiple vendors
 * collected into a single pool) cannot be sourced from a single
 * vendor, so they cannot be onboarded via the football-data pipeline.
 * The custom-tournament route is the path for those.
 *
 * Auth: requires admin. Returns 401 on unauthenticated, 403 on
 * non-admin, 400 on validation error (400 `ENDDATE_REQUIRED` when
 * `endDate` is missing — the DB CHECK constraint
 * `endDate_required_for_custom` would otherwise reject the insert),
 * 400 on duplicate name (mapped from Prisma P2002 to the
 * `NAME_TAKEN` error code).
 */

async function handleGuardError(e: unknown) {
  if (e instanceof GuardError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

export async function POST(request: Request) {
  let caller: { id: string; email: string };
  try {
    caller = await requireAdmin();
  } catch (e) {
    return handleGuardError(e);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = CreateCustomCompetitionInput.safeParse(body);
  if (!parsed.success) {
    // Surface a clean ENDDATE_REQUIRED code ONLY when endDate is the
    // sole problem and it is missing (the caller did not provide the
    // field at all — `invalid_type` from Zod's required-string check).
    // This mirrors the DB CHECK constraint `endDate_required_for_custom`
    // in `prisma/init.sql` with a stable error code. We do NOT branch
    // to ENDDATE_REQUIRED when:
    //   - The endDate is present but malformed (invalid_string from
    //     .datetime()) — falls through to VALIDATION so the caller
    //     sees the format error.
    //   - Other fields also have issues (e.g. name is empty AND
    //     endDate is missing) — falls through to VALIDATION with the
    //     full Zod issues list, which is more useful than picking a
    //     single "headline" error.
    const issues = parsed.error.issues;
    const endDateMissing =
      issues.length === 1 &&
      issues[0]?.path[0] === "endDate" &&
      issues[0]?.code === "invalid_type";
    if (endDateMissing) {
      return NextResponse.json(
        {
          error: "ENDDATE_REQUIRED",
          message:
            "Custom tournaments (externalSource = null) require an endDate. Set a UTC ISO 8601 datetime string.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "VALIDATION", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, endDate } = parsed.data;

  try {
    const created = await prisma.competition.create({
      data: {
        name,
        // Custom tournament — no vendor linkage. The cron's WHERE
        // clause (`externalSource IN (VENDORS)`) excludes this row.
        externalSource: null,
        externalLeagueId: null,
        externalSeason: null,
        // endDate is required by both the Zod schema and the DB CHECK
        // constraint `endDate_required_for_custom` (see prisma/init.sql).
        // ISO 8601 string from the schema → Date.
        endDate: new Date(endDate),
        // CREATOR + EDITORS (creator-only edit round): the calling
        // admin is the creator of this tournament and the only
        // initial editor. The manage-matches routes
        // (POST/DELETE /api/v1/admin/competitions/[id]/matches/...)
        // read `details.editors` to enforce creator-only edit —
        // a non-editor user gets 403 `NOT_EDITOR`. `createdBy` is
        // the human-readable audit trail (the same shape is used
        // on the public create-pool path; see
        // `app/api/v1/pools/route.ts`).
        details: {
          createdBy: caller.id,
          editors: [caller.id],
        },
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    // Competition.name is @unique. Map P2002 to a clean 400.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "NAME_TAKEN", message: `A competition named "${name}" already exists.` },
        { status: 400 },
      );
    }
    throw e;
  }
}
