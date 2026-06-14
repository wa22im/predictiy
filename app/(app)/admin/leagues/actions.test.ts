import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The three admin-league server actions in `actions.ts` call back into
 * their own API routes via `fetch`. The API route handlers
 * (`/api/v1/admin/competitions/...`) call `requireAdmin()` server-side,
 * which inspects the request's session cookies via Supabase. If the
 * action does not forward the user's session cookies, the route sees
 * an unauthenticated request and returns 401 NOT_AUTHENTICATED — the
 * exact "Sync failed: NOT_AUTHENTICATED" error the principal hit.
 *
 * These tests assert that the Cookie header is present on every
 * outbound fetch and that it contains the session cookies that
 * `cookies()` returned from `next/headers`.
 */

// Hoisted mock state. Using `vi.hoisted` so the mock factory
// closures can reference the same vi.fn() instances the test bodies
// mutate.
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  supabaseGetUser: vi.fn(),
  revalidatePath: vi.fn(),
  userFindUnique: vi.fn(),
  // Capture every fetch call so tests can assert on the headers.
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mocks.cookies(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mocks.userFindUnique(...args) },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => mocks.supabaseGetUser() },
    }),
}));

const realFetch = global.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = mocks.fetch as unknown as typeof fetch;
  // Default: an admin user is signed in.
  mocks.supabaseGetUser.mockResolvedValue({
    data: { user: { id: "admin-1" } },
  });
  // The requireAdmin() call in actions.ts also reads the User row to
  // confirm isAdmin. Default to admin.
  mocks.userFindUnique.mockResolvedValue({ isAdmin: true });
  // Default: cookies() returns a known session.
  mocks.cookies.mockResolvedValue({
    getAll: () => [
      { name: "sb-access-token", value: "fake-access-123" },
      { name: "sb-refresh-token", value: "fake-refresh-456" },
    ],
  });
  // Default: fetch returns a successful sync result.
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        fetched: 5,
        createdMatches: 2,
        updatedMatches: 3,
        createdMarkets: 4,
        updatedMarkets: 0,
        settledMarkets: 0,
        totalMatches: 5,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
});

afterEach(() => {
  global.fetch = realFetch;
});

import {
  syncFootballDataCompetitionAction,
  patchCompetitionAction,
  deleteCompetitionAction,
  createCustomCompetitionAction,
  addMatchesToCompetitionAction,
  removeMatchFromCompetitionAction,
} from "./actions";

describe("admin leagues server actions - cookie forwarding", () => {
  describe("syncFootballDataCompetitionAction", () => {
    it("forwards the user session cookies in the Cookie header of the fetch", async () => {
      const result = await syncFootballDataCompetitionAction("comp-1");
      expect(result.ok).toBe(true);
      expect(mocks.fetch).toHaveBeenCalledOnce();
      const init = mocks.fetch.mock.calls[0][1] as {
        headers?: Record<string, string>;
      };
      expect(init.headers).toBeDefined();
      expect(init.headers?.["Cookie"]).toContain("sb-access-token=fake-access-123");
      expect(init.headers?.["Cookie"]).toContain("sb-refresh-token=fake-refresh-456");
    });

    it("joins all cookies with a semicolon + space (RFC 6265 cookie-string format)", async () => {
      await syncFootballDataCompetitionAction("comp-1");
      const init = mocks.fetch.mock.calls[0][1] as {
        headers: Record<string, string>;
      };
      expect(init.headers["Cookie"]).toBe(
        "sb-access-token=fake-access-123; sb-refresh-token=fake-refresh-456",
      );
    });

    it("surfaces a NOT_AUTHENTICATED error returned by the route without crashing", async () => {
      // If cookies are NOT forwarded, the route returns 401 with
      // { error: "NOT_AUTHENTICATED" }. The action must surface that
      // message cleanly. The "Sync failed" wrapper uses the body's
      // error when present.
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "NOT_AUTHENTICATED" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await syncFootballDataCompetitionAction("comp-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_AUTHENTICATED");
        expect(result.status).toBe(401);
      }
    });

    it("works with an empty cookie store (no cookies present, header is empty string)", async () => {
      mocks.cookies.mockResolvedValueOnce({ getAll: () => [] });
      const result = await syncFootballDataCompetitionAction("comp-1");
      expect(result.ok).toBe(true);
      const init = mocks.fetch.mock.calls[0][1] as {
        headers: Record<string, string>;
      };
      expect(init.headers["Cookie"]).toBe("");
    });
  });

  describe("patchCompetitionAction", () => {
    it("forwards the user session cookies in the Cookie header of the fetch", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comp-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await patchCompetitionAction("comp-1", { name: "New" });
      expect(result.ok).toBe(true);
      const init = mocks.fetch.mock.calls[0][1] as {
        headers: Record<string, string>;
      };
      expect(init.headers["Cookie"]).toContain("sb-access-token=fake-access-123");
    });

    it("uses method PATCH and posts a JSON body", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comp-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await patchCompetitionAction("comp-1", { name: "New" });
      const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/admin/competitions/comp-1");
      expect(init.method).toBe("PATCH");
      expect(init.body).toBe(JSON.stringify({ name: "New" }));
    });
  });

  describe("deleteCompetitionAction", () => {
    it("forwards the user session cookies in the Cookie header of the fetch", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "comp-1", deletedAt: "2026-06-14T00:00:00Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      const result = await deleteCompetitionAction("comp-1");
      expect(result.ok).toBe(true);
      const init = mocks.fetch.mock.calls[0][1] as {
        headers: Record<string, string>;
      };
      expect(init.headers["Cookie"]).toContain("sb-access-token=fake-access-123");
    });

    it("uses method DELETE", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "comp-1", deletedAt: "2026-06-14T00:00:00Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await deleteCompetitionAction("comp-1");
      const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/admin/competitions/comp-1");
      expect(init.method).toBe("DELETE");
    });
  });

  // The three new custom-tournament actions: create competition,
  // add matches, remove match. They follow the same cookie-forwarding
  // contract as the existing actions — every outbound fetch MUST
  // include the user's session cookies in the Cookie header so the
  // API route's requireAdmin() can authenticate. The tests below
  // assert on the method, URL, and request body for each action.
  describe("createCustomCompetitionAction", () => {
    it("forwards the user session cookies in the Cookie header of the fetch", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comp-1", name: "My Custom Cup" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await createCustomCompetitionAction({ name: "My Custom Cup" });
      expect(result.ok).toBe(true);
      const init = mocks.fetch.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers["Cookie"]).toContain("sb-access-token=fake-access-123");
    });

    it("uses method POST and the correct URL", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comp-1", name: "My Custom Cup" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await createCustomCompetitionAction({ name: "My Custom Cup" });
      const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/admin/competitions");
      // No [id] in the path — this is the create endpoint.
      expect(url).not.toContain("/comp-1");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ name: "My Custom Cup" }));
    });

    it("returns ok:true with the new competition's id and name on success", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comp-new", name: "My Custom Cup" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await createCustomCompetitionAction({ name: "My Custom Cup" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.id).toBe("comp-new");
        expect(result.name).toBe("My Custom Cup");
      }
    });

    it("surfaces a NAME_TAKEN error from the route (400)", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "NAME_TAKEN" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await createCustomCompetitionAction({ name: "Duplicate" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NAME_TAKEN");
        expect(result.status).toBe(400);
      }
    });

    it("rejects when name is missing without making a fetch", async () => {
      const result = await createCustomCompetitionAction({ name: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Missing competition name");
      }
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });

  describe("addMatchesToCompetitionAction", () => {
    it("forwards the user session cookies in the Cookie header of the fetch", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ added: 2, requested: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await addMatchesToCompetitionAction("comp-1", ["m1", "m2"]);
      expect(result.ok).toBe(true);
      const init = mocks.fetch.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers["Cookie"]).toContain("sb-access-token=fake-access-123");
    });

    it("uses method POST with the competition id in the URL and matchIds in the body", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ added: 2, requested: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await addMatchesToCompetitionAction("comp-1", ["m1", "m2"]);
      const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/admin/competitions/comp-1/matches");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ matchIds: ["m1", "m2"] }));
    });

    it("returns ok:true with the count of added matches on success", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ added: 2, requested: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await addMatchesToCompetitionAction("comp-1", ["m1", "m2"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.added).toBe(2);
        expect(result.requested).toBe(2);
      }
    });

    it("surfaces a MATCH_NOT_FOUND error from the route (404)", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "MATCH_NOT_FOUND" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await addMatchesToCompetitionAction("comp-1", ["m-missing"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("MATCH_NOT_FOUND");
        expect(result.status).toBe(404);
      }
    });

    it("rejects when matchIds is empty without making a fetch", async () => {
      const result = await addMatchesToCompetitionAction("comp-1", []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("non-empty array");
      }
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });

  describe("removeMatchFromCompetitionAction", () => {
    it("forwards the user session cookies in the Cookie header of the fetch", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ removed: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await removeMatchFromCompetitionAction("comp-1", "m1");
      expect(result.ok).toBe(true);
      const init = mocks.fetch.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers["Cookie"]).toContain("sb-access-token=fake-access-123");
    });

    it("uses method DELETE with both competition id and matchId in the URL", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ removed: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await removeMatchFromCompetitionAction("comp-1", "m1");
      const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/v1/admin/competitions/comp-1/matches/m1");
      expect(init.method).toBe("DELETE");
    });

    it("returns ok:true with `removed: true` on successful delete", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ removed: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await removeMatchFromCompetitionAction("comp-1", "m1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.removed).toBe(true);
      }
    });

    it("returns ok:true with `removed: false` on idempotent re-delete", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ removed: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await removeMatchFromCompetitionAction("comp-1", "m1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.removed).toBe(false);
      }
    });

    it("surfaces a MATCH_ALREADY_PLAYED error from the route (400)", async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "MATCH_ALREADY_PLAYED",
            message: "Cannot remove a match that has already been played.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );
      const result = await removeMatchFromCompetitionAction("comp-1", "m1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("MATCH_ALREADY_PLAYED");
        expect(result.status).toBe(400);
      }
    });
  });
});
