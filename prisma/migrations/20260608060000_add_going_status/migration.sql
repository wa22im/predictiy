-- Add GOING to the MatchStatus enum.
-- Used to represent a match that is in progress (kickoff has passed but
-- the final whistle has not). Distinct from SCHEDULED (kickoff still in
-- the future) and FINISHED (full-time reached).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, but
-- Prisma wraps each migration in a transaction by default. We set
-- `disable_ddl_transaction!` in the migration.toml equivalent (Prisma
-- looks at the migration runner config; for client-side `migrate dev`,
-- the user can also run this manually as a single statement if
-- Prisma's transaction wrapper fails on it).
--
-- Postgres 12+ allows IF NOT EXISTS on ADD VALUE — safe to re-run.

ALTER TYPE "MatchStatus" ADD VALUE IF NOT EXISTS 'GOING';
