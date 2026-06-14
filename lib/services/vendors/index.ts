/**
 * Vendor registry.
 *
 * The cron iterates `VENDORS` and dispatches each competition to the
 * matching adapter via `getVendorAdapter`. New vendors are added by
 *   1. Implementing `VendorAdapter` in `lib/services/vendors/<vendor>.ts`
 *   2. Adding the adapter to `REGISTRY` here
 *   3. Adding the vendor name to `VENDORS` (so the cron iterates it)
 *   4. Updating the Zod schema in `lib/validation/admin.ts` so the
 *      admin endpoints accept the new `externalSource` value
 *
 * Note on `VENDORS`:
 *   The list deliberately excludes `"manual"`. AGENTS.md documents
 *   that a Competition with `externalSource = null` (a.k.a. "manual")
 *   cannot be auto-synced by the cron — the data was hand-entered
 *   via the Hydration Terminal. The cron iterates `VENDORS` and
 *   queries `Competition.externalSource` against each entry, so
 *   `"manual"` rows are skipped automatically.
 *
 * Note on `fixturedownload`:
 *   The vendor name is in `VENDORS` (so the cron iterates it and the
 *   response shape is stable) but the adapter is not yet implemented.
 *   `getVendorAdapter("fixturedownload")` will throw with a clear
 *   error message; the cron catches that error per-competition and
 *   surfaces it in the response. Adding the adapter is a future task.
 */

import type { Vendor, VendorAdapter } from "./adapter";
import { footballDataAdapter } from "./football-data";

/**
 * Map from auto-syncable vendor name to its concrete adapter
 * implementation. `"manual"` is intentionally absent — manual
 * competitions are hand-entered and have no adapter. The
 * `Partial<>` is required because `fixturedownload` is in the
 * `Vendor` type and the `VENDORS` list (so the cron iterates it)
 * but the adapter is not yet implemented — the `getVendorAdapter`
 * throw handles the "future-registered vendor" case.
 */
const REGISTRY: Partial<Record<Exclude<Vendor, "manual">, VendorAdapter>> = {
  "football-data": footballDataAdapter,
  // "fixturedownload": fixturedownloadAdapter,  // future
};

/**
 * The list of vendors the cron will attempt to sync. A vendor in this
 * list without a registered adapter will produce a per-competition
 * error in the cron response (via the `getVendorAdapter` throw).
 */
export const VENDORS: Vendor[] = ["football-data", "fixturedownload"];

/**
 * Look up the adapter for a given auto-syncable vendor. Throws if
 * the vendor is in the `Vendor` type but not yet implemented in
 * `REGISTRY` (i.e. a future-registered vendor) or if the caller
 * passes `"manual"` (which has no adapter by design).
 */
export function getVendorAdapter(
  vendor: Exclude<Vendor, "manual">,
): VendorAdapter {
  const adapter = REGISTRY[vendor];
  if (!adapter) {
    throw new Error(`No vendor adapter registered for ${vendor}`);
  }
  return adapter;
}

// Re-export the concrete adapter so callers can grab it directly
// without going through the registry, and re-export the types
// so consumers can import everything from `./vendors`.
export { footballDataAdapter };
export * from "./adapter";
