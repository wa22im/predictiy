import { describe, it, expect } from "vitest";
import { checkSyncCooldown, SYNC_COOLDOWN_MS } from "./sync-cooldown";

/**
 * Table-driven coverage of the cooldown policy (see ISC
 * isc-cooldown.md). The function is pure, so we pin a fixed `now`
 * and reason about the inputs in terms of "ms since last sync".
 *
 * Boundary notes:
 *   - "Just under 5 min" must still be RATE_LIMITED.
 *   - "Exactly 5 min" must be allowed (boundary is inclusive: a
 *     sync at t=0 permits the next sync at t=300_000ms).
 *   - "Just over 5 min" must be allowed.
 */
describe("checkSyncCooldown", () => {
  const now = new Date("2026-06-13T20:00:00Z");

  it("allows when lastSyncedAt is null (never synced)", () => {
    const result = checkSyncCooldown({
      lastSyncedAt: null,
      hasUpcomingMatches: true,
      now,
    });
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBeNull();
    expect(result.reason).toBe("OK");
  });

  it("allows when hasUpcomingMatches is false, regardless of lastSyncedAt", () => {
    const lastSync = new Date(now.getTime() - 60_000);
    const result = checkSyncCooldown({
      lastSyncedAt: lastSync,
      hasUpcomingMatches: false,
      now,
    });
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBeNull();
    expect(result.reason).toBe("NO_UPCOMING_MATCHES");
  });

  it("allows when hasUpcomingMatches is false and lastSyncedAt is null", () => {
    const result = checkSyncCooldown({
      lastSyncedAt: null,
      hasUpcomingMatches: false,
      now,
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("NO_UPCOMING_MATCHES");
  });

  it("allows when last sync was > 5 min ago and upcoming matches exist", () => {
    const lastSync = new Date(now.getTime() - 6 * 60 * 1000);
    const result = checkSyncCooldown({
      lastSyncedAt: lastSync,
      hasUpcomingMatches: true,
      now,
    });
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBeNull();
    expect(result.reason).toBe("OK");
  });

  it("blocks when last sync was 1 min ago and upcoming matches exist", () => {
    const lastSync = new Date(now.getTime() - 60_000);
    const result = checkSyncCooldown({
      lastSyncedAt: lastSync,
      hasUpcomingMatches: true,
      now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("RATE_LIMITED");
    expect(result.retryAfterMs).toBe(SYNC_COOLDOWN_MS - 60_000);
  });

  it("blocks at the exact 5-min boundary minus 1ms", () => {
    const lastSync = new Date(now.getTime() - (SYNC_COOLDOWN_MS - 1));
    const result = checkSyncCooldown({
      lastSyncedAt: lastSync,
      hasUpcomingMatches: true,
      now,
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(1);
  });

  it("allows at exactly 5 min (boundary is inclusive)", () => {
    const lastSync = new Date(now.getTime() - SYNC_COOLDOWN_MS);
    const result = checkSyncCooldown({
      lastSyncedAt: lastSync,
      hasUpcomingMatches: true,
      now,
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("OK");
  });
});
