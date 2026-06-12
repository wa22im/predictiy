import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The new design system palette is a closed set of five colors:
 *   #353535 (ink)         - background / surface base
 *   #3c6e71 (teal)        - card / popover surface
 *   #ffffff (paper)       - foreground / card-foreground
 *   #d9d9d9 (fog)         - borders, accents, secondary/muted surfaces
 *   #284b63 (deep blue)   - primary, card-elevated, locked
 *
 * Any "core" token (background/foreground, card, popover, primary, accent,
 * secondary, muted, border, input, ring, and their -foreground siblings) must
 * be one of these five. The semantic state colors (destructive, success,
 * warning, gold, magenta, rating tiers) are allowed to keep their existing
 * hue identities, as are the overlay rgba and the chart slots. The chart
 * slots in turn must also stay inside the palette.
 *
 * No radial-gradient may live anywhere in the repo - the prior neon look
 * has been replaced by flat, bordered, shadow-driven cards.
 */

const PALETTE = ["#353535", "#3c6e71", "#ffffff", "#d9d9d9", "#284b63"] as const;

const CORE_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "card-elevated",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "ring",
] as const;

const CHART_TOKEN_NAMES = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

const globalsCssPath = resolve(process.cwd(), "app/globals.css");
const globalsCss = readFileSync(globalsCssPath, "utf8");

/**
 * Walk a CSS string and return the (token, value) pair for every
 * `--foo: value;` declaration. The previous globals.css did not use
 * the same name twice inside one block, so a flat Map is enough for
 * assertion purposes - the test below disambiguates `:root` vs
 * `@media (prefers-color-scheme: dark) :root` by splitting the file.
 */
function extractBlocks(css: string): { label: string; body: string }[] {
  const blocks: { label: string; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    // Skip any non-block statements (@import, @charset, etc. terminated
    // by a semicolon). These appear before any rule block.
    if (css[i] === "@") {
      const semi = css.indexOf(";", i);
      const nextOpen = css.indexOf("{", i);
      if (semi !== -1 && (nextOpen === -1 || semi < nextOpen)) {
        i = semi + 1;
        continue;
      }
    }
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const label = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    blocks.push({ label, body });
    i = j;
  }
  return blocks;
}

/**
 * Inside an @media block, find the inner `:root { ... }` rule body. The
 * current globals.css only has a single inner :root, so a flat find is
 * enough.
 */
function findInnerRootBody(outerBody: string): string | undefined {
  const m = outerBody.match(/:root\s*\{([^{}]*)\}/);
  return m ? m[1] : undefined;
}

function tokenValue(blockBody: string, name: string): string | undefined {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`);
  const m = blockBody.match(re);
  return m ? m[1].trim() : undefined;
}

const blocks = extractBlocks(globalsCss);
const rootBlock = blocks.find((b) => b.label === ":root");
const darkMediaBlock = blocks.find((b) =>
  /prefers-color-scheme:\s*dark/.test(b.label),
);
const darkRootBody = darkMediaBlock
  ? findInnerRootBody(darkMediaBlock.body)
  : undefined;

function paletteRow(label: string, blockBody: string | undefined) {
  return {
    label,
    block: blockBody,
    pairs: blockBody
      ? CORE_TOKEN_NAMES.map((name) => ({
          name,
          value: tokenValue(blockBody, name),
        }))
      : [],
  };
}

const table = [
  paletteRow(":root (light)", rootBlock?.body),
  paletteRow("@media (prefers-color-scheme: dark) :root", darkRootBody),
];

describe("globals.css - new color palette", () => {
  it.each(table)(
    "%s: every core token resolves to a value inside the new palette",
    ({ label, block, pairs }) => {
      expect(block, `${label} block should exist`).toBeDefined();
      for (const { name, value } of pairs) {
        expect(
          value,
          `${label}: --${name} should be declared`,
        ).toBeDefined();
        expect(
          PALETTE as readonly string[],
          `${label}: --${name} = ${value} should be in palette`,
        ).toContain(value);
      }
    },
  );

  it.each(table)(
    "%s: --chart-N tokens are also inside the new palette",
    ({ block }) => {
      expect(block).toBeDefined();
      for (const name of CHART_TOKEN_NAMES) {
        const v = tokenValue(block!, name);
        expect(v, `--${name} should be declared`).toBeDefined();
        expect(
          PALETTE as readonly string[],
          `--${name} = ${v} should be in palette`,
        ).toContain(v);
      }
    },
  );

  it("no radial-gradient is declared anywhere in globals.css", () => {
    expect(globalsCss).not.toMatch(/radial-gradient/);
  });
});

/**
 * No hardcoded colors should remain in component TSX files - the design
 * system routes every color through semantic tokens defined in
 * app/globals.css. This guards against one-off hex / rgb literals that
 * would silently fall out of sync with the palette.
 *
 * The kit-swatch component intentionally takes arbitrary team kit colors
 * as props (they are data, not styling), so the file is excluded.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXCLUDE_FILES = new Set([
  // Kit colors are data passed in as props; the swatch itself has no
  // hardcoded color.
  "kit-swatch.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const tsxFiles = walk(resolve(process.cwd(), "components"))
  .concat(walk(resolve(process.cwd(), "app")).filter((p) => p.endsWith(".tsx")));

describe("component files - no hardcoded colors", () => {
  it.each(
    tsxFiles
      .filter((p) => !EXCLUDE_FILES.has(p.split("/").pop()!))
      .map((p) => [p.replace(process.cwd() + "/", ""), p]),
  )("%s contains no hex color literal", (_label, absPath) => {
    const src = readFileSync(absPath, "utf8");
    expect(
      src,
      `${absPath} should not contain a hex color literal`,
    ).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it.each(
    tsxFiles
      .filter((p) => !EXCLUDE_FILES.has(p.split("/").pop()!))
      .map((p) => [p.replace(process.cwd() + "/", ""), p]),
  )("%s contains no rgb/rgba/hsl color literal", (_label, absPath) => {
    const src = readFileSync(absPath, "utf8");
    expect(
      src,
      `${absPath} should not contain an rgb/rgba/hsl color literal`,
    ).not.toMatch(/\b(rgb|rgba|hsl|hsla)\s*\(/);
  });
});

describe("project - no radial-gradient anywhere", () => {
  it.each(
    tsxFiles.map((p) => [p.replace(process.cwd() + "/", ""), p]),
  )("%s contains no radial-gradient", (_label, absPath) => {
    const src = readFileSync(absPath, "utf8");
    expect(src).not.toMatch(/radial-gradient/);
  });
});
