import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, GuardError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/v1/admin/competitions/[id]
 * DELETE /api/v1/admin/competitions/[id]
 *
 * Tournament edit + soft delete.
 *
 * PATCH accepts partial updates to { name, endDate, externalLeagueId,
 * externalSeason, details }. The schema is `.strict()` so unknown
 * fields (notably `deletedAt`) are rejected — only DELETE can set
 * the soft-delete column. The `details` field is a free-form JSON
 * object; we don't validate its shape here, but we DO require it to
 * be a non-array object (zod's `z.record(z.string(), z.unknown())`).
 *
 * DELETE soft-deletes the row by stamping `deletedAt = now()`. The
 * row's data is preserved — an admin can un-delete by clearing the
 * column. Repeated DELETE calls are idempotent (the second call
 * returns 200 without rewriting the column).
 *
 * Both handlers require admin auth. The shared `requireAdmin()` guard
 * checks the JWT + the `isAdmin` flag on the public.User row.
 */

const PatchInput = z
  .object({
    name: z.string().min(1).max(200).optional(),
    endDate: z.string().datetime().nullable().optional(),
    externalLeagueId: z.string().nullable().optional(),
    externalSeason: z.number().int().nullable().optional(),
    details: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

async function handleGuardError(e: unknown) {
  if (e instanceof GuardError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
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

  const parsed = PatchInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await prisma.competition.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Build the partial update — only include fields the caller
  // actually provided. `undefined` means "leave alone", `null` means
  // "clear the column". We rely on the zod schema's optional+nullable
  // to distinguish the two.
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.endDate !== undefined) {
    data.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  }
  if (parsed.data.externalLeagueId !== undefined) {
    data.externalLeagueId = parsed.data.externalLeagueId;
  }
  if (parsed.data.externalSeason !== undefined) {
    data.externalSeason = parsed.data.externalSeason;
  }
  if (parsed.data.details !== undefined) data.details = parsed.data.details;

  if (Object.keys(data).length === 0) {
    // No-op PATCH — return the current row. Avoids an unnecessary
    // write and gives admins a sensible response for a malformed
    // (but not invalid) PATCH.
    return NextResponse.json(existing);
  }

  const updated = await prisma.competition.update({
    where: { id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    return handleGuardError(e);
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  }

  const existing = await prisma.competition.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (existing.deletedAt) {
    // Already soft-deleted; idempotent — return 200.
    return NextResponse.json({ id: existing.id, deletedAt: existing.deletedAt });
  }

  const updated = await prisma.competition.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return NextResponse.json({ id: updated.id, deletedAt: updated.deletedAt });
}
