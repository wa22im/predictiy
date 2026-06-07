# Next.js Version Audit

Audit date: 2026-06-07

## Current state

- **Next.js:** 15.5.19 (stable backport tag)
- **React:** 19.2.7 (latest stable)
- **React DOM:** 19.2.7

## Why we reverted

The initial scaffolding was created with `create-next-app` which installed `next@16.2.7`.
Next.js 16 is the canary/latest channel with breaking changes in:
- App Router API shapes
- Route Handler conventions
- Middleware signatures
- `params` and `searchParams` types

Since the existing design system (`DESIGN.md`) and AGENTS.md were built for the stable Next.js 15 convention, we reverted to the official `backport` tag: `next@15.5.19`.

## What NEXTJS16_NOTES.md means

This file serves as a reminder: **if any future developer upgrades to Next.js 16+,**
the original `node_modules/next/dist/docs/` guide should be consulted before writing code.

## Compatible dependency ranges (tested)

| Package | Version |
|---|---|
| next | 15.5.19 |
| react | 19.2.7 |
| react-dom | 19.2.7 |
| eslint-config-next | 15.5.19 |
| @supabase/supabase-js | 2.107.0 |
| @supabase/ssr | 0.10.3 |
| @prisma/client | 7.8.0 |
| prisma | 7.8.0 |
| zod | 4.4.3 |
