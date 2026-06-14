import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  userUpdate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: () => mocks.getUser() } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { update: mocks.userUpdate } },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args),
}));

import { updateProfileAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  mocks.userUpdate.mockResolvedValue({ id: "u1", nickname: "Test", emoji: "⚽" });
});

describe("updateProfileAction", () => {
  it("updates the user profile", async () => {
    const result = await updateProfileAction({ nickname: "NewNick", emoji: "🦅" });
    expect(result.ok).toBe(true);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { nickname: "NewNick", emoji: "🦅" },
      select: { id: true, nickname: true, emoji: true },
    });
  });

  it("rejects empty nickname", async () => {
    const result = await updateProfileAction({ nickname: "", emoji: "🦅" });
    expect(result.ok).toBe(false);
  });

  it("rejects empty emoji", async () => {
    const result = await updateProfileAction({ nickname: "Test", emoji: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects too-long nickname", async () => {
    const result = await updateProfileAction({ nickname: "x".repeat(41), emoji: "🦅" });
    expect(result.ok).toBe(false);
  });

  it("returns error when not authenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const result = await updateProfileAction({ nickname: "Test", emoji: "🦅" });
    expect(result.ok).toBe(false);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});
