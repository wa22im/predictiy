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

vi.mock("@/lib/services/ingest-league", () => ({
  ingestLeague: vi.fn(),
  syncCompetition: vi.fn(),
}));

vi.mock("@/lib/services/api-football", () => ({
  ApiFootballError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
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
});
