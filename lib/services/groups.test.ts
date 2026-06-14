import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for lib/services/groups.ts.
 *
 * The `createdBy` permission field lives in `Group.details.createdBy`
 * (JSONB) instead of a typed column. This is a backward-compatibility
 * choice:
 *
 *   - Existing groups have no `createdBy` → rename returns 403 with a
 *     LEGACY_GROUP_NO_CREATOR message.
 *   - New groups write `details.createdBy = user.id` at creation time
 *     (see app/(app)/dashboard/actions.ts).
 *   - The principal can manually backfill legacy groups via a DB
 *     script if needed; this service does not auto-backfill.
 *
 * We mock `revalidatePath` from next/cache so the service can be
 * imported in a unit test without a Next.js runtime.
 */

// Mock server-only so the service module is importable in unit tests.
vi.mock("server-only", () => ({}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const groupFindUnique = vi.fn();
const groupUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    group: {
      findUnique: (...args: unknown[]) => groupFindUnique(...args),
      update: (...args: unknown[]) => groupUpdate(...args),
    },
  },
}));

import { renameGroup, classifyGroupArchive } from "./groups";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: prisma returns a group owned by "creator-1".
  groupFindUnique.mockResolvedValue({
    id: "g-1",
    name: "Old",
    details: { createdBy: "creator-1" },
  });
  groupUpdate.mockResolvedValue({ id: "g-1", name: "New" });
});

describe("renameGroup", () => {
  it("renames the group when the caller is the creator", async () => {
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "creator-1",
      newName: "Renamed",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.group).toEqual({ id: "g-1", name: "New" });
    }
    // The update is called with the trimmed name.
    expect(groupUpdate).toHaveBeenCalledWith({
      where: { id: "g-1" },
      data: { name: "Renamed" },
      select: { id: true, name: true },
    });
    // We revalidate both /groups and /groups/[id] so the change
    // shows up on the listing and the detail page.
    expect(revalidatePath).toHaveBeenCalledWith("/groups/g-1");
    expect(revalidatePath).toHaveBeenCalledWith("/groups");
  });

  it("returns 404 when the group does not exist", async () => {
    groupFindUnique.mockResolvedValueOnce(null);
    const result = await renameGroup({
      groupId: "missing",
      callerId: "u-1",
      newName: "X",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("GROUP_NOT_FOUND");
      expect(result.status).toBe(404);
    }
    expect(groupUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not the creator", async () => {
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "someone-else",
      newName: "Renamed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("FORBIDDEN_ONLY_CREATOR_CAN_RENAME");
      expect(result.status).toBe(403);
    }
    expect(groupUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 with LEGACY_GROUP_NO_CREATOR when details.createdBy is missing", async () => {
    // Existing group with details present but no createdBy key.
    groupFindUnique.mockResolvedValueOnce({
      id: "g-1",
      name: "Old",
      details: { otherField: "foo" },
    });
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "u-1",
      newName: "Renamed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("LEGACY_GROUP_NO_CREATOR");
      expect(result.status).toBe(403);
    }
    expect(groupUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 with LEGACY_GROUP_NO_CREATOR when details is null", async () => {
    groupFindUnique.mockResolvedValueOnce({
      id: "g-1",
      name: "Old",
      details: null,
    });
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "u-1",
      newName: "Renamed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("LEGACY_GROUP_NO_CREATOR");
      expect(result.status).toBe(403);
    }
  });

  it("returns 400 for an empty or whitespace-only new name", async () => {
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "creator-1",
      newName: "   ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INVALID_NAME_LENGTH");
      expect(result.status).toBe(400);
    }
    expect(groupUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for a name longer than 80 characters", async () => {
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "creator-1",
      newName: "x".repeat(81),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("INVALID_NAME_LENGTH");
      expect(result.status).toBe(400);
    }
  });

  it("trims surrounding whitespace from the new name before persisting", async () => {
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "creator-1",
      newName: "  Trimmed  ",
    });
    expect(result.ok).toBe(true);
    expect(groupUpdate).toHaveBeenCalledWith({
      where: { id: "g-1" },
      data: { name: "Trimmed" },
      select: { id: true, name: true },
    });
  });

  it("ignores a non-string details.createdBy (defensive: bad data should not grant permission)", async () => {
    groupFindUnique.mockResolvedValueOnce({
      id: "g-1",
      name: "Old",
      details: { createdBy: 42 },
    });
    const result = await renameGroup({
      groupId: "g-1",
      callerId: "u-1",
      newName: "Renamed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Non-string createdBy is treated the same as missing.
      expect(result.error).toBe("LEGACY_GROUP_NO_CREATOR");
      expect(result.status).toBe(403);
    }
  });
});

describe("classifyGroupArchive", () => {
  it("returns 'manual' when there is no linked competition", () => {
    const status = classifyGroupArchive(null, new Date("2026-06-14T00:00:00Z"));
    expect(status).toBe("manual");
  });

  it("returns 'active' when the typed endDate is null (open-ended competition)", () => {
    const status = classifyGroupArchive(
      { endDate: null },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("active");
  });

  it("returns 'active' when the typed endDate is in the future", () => {
    const status = classifyGroupArchive(
      { endDate: new Date("2026-12-31T00:00:00Z") },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("active");
  });

  it("returns 'archived' when the typed endDate is in the past and no grace is set", () => {
    const status = classifyGroupArchive(
      { endDate: new Date("2026-06-01T00:00:00Z") },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("archived");
  });

  it("prefers details.endDateWithGrace over the typed endDate column (future grace → active)", () => {
    // Typed endDate is in the past (June 1), but the grace date is
    // 4 days from now (June 18) — should still be active.
    const status = classifyGroupArchive(
      {
        endDate: new Date("2026-06-01T00:00:00Z"),
        details: { endDateWithGrace: "2026-06-18T00:00:00Z" },
      },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("active");
  });

  it("uses details.endDateWithGrace to mark 'archived' when it has elapsed (past grace)", () => {
    // Typed endDate is in the past (June 1) and the grace date is
    // also in the past (June 5) — should be archived.
    const status = classifyGroupArchive(
      {
        endDate: new Date("2026-06-01T00:00:00Z"),
        details: { endDateWithGrace: "2026-06-05T00:00:00Z" },
      },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("archived");
  });

  it("falls back to the typed endDate when endDateWithGrace is absent", () => {
    // details is present but has no endDateWithGrace key — fall
    // back to endDate.
    const status = classifyGroupArchive(
      {
        endDate: new Date("2026-12-31T00:00:00Z"),
        details: { otherField: "x" },
      },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("active");
  });

  it("falls back to the typed endDate when details is null", () => {
    const status = classifyGroupArchive(
      {
        endDate: new Date("2026-12-31T00:00:00Z"),
        details: null,
      },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("active");
  });

  it("falls back to the typed endDate when endDateWithGrace is malformed", () => {
    // Grace string is garbage; the function should treat it as
    // absent and use the typed endDate.
    const status = classifyGroupArchive(
      {
        endDate: new Date("2026-12-31T00:00:00Z"),
        details: { endDateWithGrace: "not-a-date" },
      },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("active");
  });

  it("ignores a non-string endDateWithGrace (defensive: bad data should not crash)", () => {
    const status = classifyGroupArchive(
      {
        endDate: new Date("2026-12-31T00:00:00Z"),
        details: { endDateWithGrace: 42 },
      },
      new Date("2026-06-14T00:00:00Z"),
    );
    expect(status).toBe("active");
  });
});
