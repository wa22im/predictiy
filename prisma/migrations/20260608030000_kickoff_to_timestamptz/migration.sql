-- Convert Match.kickoffTime from TIMESTAMP (naive) to TIMESTAMPTZ
-- (timezone-aware). Postgres interprets the existing naive values as
-- the session timezone (UTC for Supabase pooler), so the wall-clock
-- value is preserved — only the type changes.
--
-- Why: storing without timezone relies on every reader agreeing on the
-- implicit timezone. With TIMESTAMPTZ, the instant in time is
-- unambiguous regardless of session timezone.

ALTER TABLE "Match"
  ALTER COLUMN "kickoffTime" TYPE TIMESTAMPTZ(3)
  USING "kickoffTime" AT TIME ZONE 'UTC';
