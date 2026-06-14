/**
 * Tests for the vendor registry. Verifies the contract that the cron
 * relies on:
 *   - VENDORS is the list of auto-syncable vendors (excludes "manual")
 *   - getVendorAdapter returns the concrete adapter for each
 *   - getVendorAdapter throws for unknown vendors
 *
 * These are the key invariants that adding a new vendor must
 * preserve.
 */

import { describe, it, expect, vi } from "vitest";

// The football-data adapter (re-exported via ./index) transitively
// imports the football-data v4 client, which has a `server-only`
// guard. We don't need the client in these tests — we're only
// exercising the registry, not the adapter's HTTP calls — so we
// mock the entire module away.
vi.mock("./football-data", () => ({ footballDataAdapter: { name: "football-data" } }));
// Also mock server-only at the module level (the adapter is
// re-exported through index.ts and would otherwise fail to import
// in the test environment).
vi.mock("server-only", () => ({}));

import { VENDORS, getVendorAdapter, footballDataAdapter } from "./index";
import { footballDataAdapter as directAdapter } from "./football-data";
import type { Vendor } from "./adapter";

describe("vendor registry", () => {
  it("VENDORS includes 'football-data' (the only adapter wired today)", () => {
    expect(VENDORS).toContain("football-data");
  });

  it("VENDORS includes 'fixturedownload' (declared in the ISC, even though the adapter is not implemented yet)", () => {
    // The ISC explicitly lists fixturedownload in VENDORS. The cron
    // iterates the list and skips competitions whose vendor is not in
    // the registry. By including the name in VENDORS, we make the
    // "skipped" behavior visible in the response shape — see the
    // isc-cleanup-and-vendor.md and multi-vendor-clarification.md
    // discussion of "future-registered vendors".
    expect(VENDORS).toContain("fixturedownload");
  });

  it("VENDORS does not include 'manual' (manual competitions cannot be auto-synced)", () => {
    // AGENTS.md explicitly documents that competitions with
    // externalSource=null (a.k.a. "manual") are skipped by the cron.
    // They must not appear in the auto-sync registry.
    expect(VENDORS).not.toContain("manual");
  });

  it("VENDORS contains only valid Vendor values", () => {
    const validVendors: Vendor[] = ["football-data", "fixturedownload", "manual"];
    for (const v of VENDORS) {
      expect(validVendors).toContain(v);
    }
  });

  it("getVendorAdapter('football-data') returns the football-data adapter instance", () => {
    const adapter = getVendorAdapter("football-data");
    expect(adapter).toBe(directAdapter);
    expect(adapter.name).toBe("football-data");
  });

  it("getVendorAdapter returns the same instance for repeated lookups (registry is a singleton)", () => {
    const a = getVendorAdapter("football-data");
    const b = getVendorAdapter("football-data");
    expect(a).toBe(b);
  });

  it("getVendorAdapter throws for 'manual' (manual is never auto-syncable)", () => {
    // The TS type already excludes "manual" from the registry, but
    // the runtime check is also there as a defensive guard. This
    // test casts through `as unknown as` to exercise the runtime
    // path even though the type would prevent a normal caller.
    expect(() =>
      getVendorAdapter("manual" as unknown as Exclude<Vendor, "manual">),
    ).toThrow(/no vendor adapter registered for manual/i);
  });

  it("getVendorAdapter throws for a vendor that is registered in the Vendor type but not yet implemented", () => {
    // Fixturedownload is in the VENDORS array (and in the Vendor
    // type), but its adapter is not yet implemented. The registry
    // must throw with a clear message so a cron run that picks up a
    // fixturedownload competition fails loudly rather than silently
    // skipping it.
    expect(() => getVendorAdapter("fixturedownload")).toThrow(
      /no vendor adapter registered for fixturedownload/i,
    );
  });

  it("the re-exported footballDataAdapter matches the one in the index module", () => {
    // The registry re-exports the adapter so callers can do
    // `import { footballDataAdapter } from "./vendors"` if they
    // want a specific adapter without going through the registry.
    expect(footballDataAdapter).toBe(directAdapter);
  });
});
