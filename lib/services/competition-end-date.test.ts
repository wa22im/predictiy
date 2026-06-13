import { describe, it, expect } from "vitest";
import { parseCompetitionEndDate } from "./competition-end-date";

/**
 * The parser is defensive by design: any null-ish / blank / malformed
 * input must return `undefined` so the Prisma upsert call doesn't
 * clobber an existing endDate. The "happy path" cases assert the exact
 * timestamp (UTC midnight for YYYY-MM-DD) so a regression in the Date
 * parsing is caught.
 *
 * `getTime()` is the canonical equality check — the result is a Date,
 * and Date#toBe uses Object.is, which fails for structurally-equal
 * Date instances. We compare the underlying numeric timestamp.
 */
describe("parseCompetitionEndDate", () => {
  const cases: { name: string; input: unknown; expected: number | undefined }[] = [
    {
      name: "valid YYYY-MM-DD yields UTC midnight",
      input: "2026-07-19",
      expected: Date.UTC(2026, 6, 19),
    },
    {
      name: "valid YYYY-MM-DD with surrounding whitespace is trimmed",
      input: "  2026-07-19  ",
      expected: Date.UTC(2026, 6, 19),
    },
    {
      name: "valid ISO datetime is accepted (defensive — providers may add time)",
      input: "2026-07-19T00:00:00Z",
      expected: Date.UTC(2026, 6, 19),
    },
    {
      name: "null returns undefined",
      input: null,
      expected: undefined,
    },
    {
      name: "undefined returns undefined",
      input: undefined,
      expected: undefined,
    },
    {
      name: "empty string returns undefined",
      input: "",
      expected: undefined,
    },
    {
      name: "whitespace-only string returns undefined",
      input: "   ",
      expected: undefined,
    },
    {
      name: "garbage string returns undefined",
      input: "not-a-date",
      expected: undefined,
    },
    {
      name: "invalid month/day returns undefined",
      input: "2026-13-99",
      expected: undefined,
    },
    {
      name: "non-string value returns undefined",
      input: 20260719,
      expected: undefined,
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      const result = parseCompetitionEndDate(input);
      if (expected === undefined) {
        expect(result).toBeUndefined();
      } else {
        expect(result).toBeInstanceOf(Date);
        expect(result?.getTime()).toBe(expected);
      }
    });
  }
});
