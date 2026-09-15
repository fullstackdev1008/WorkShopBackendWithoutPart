-- AI-1 — persist the selected Evolve Job Type on the job card.
--
-- Nullable, no backfill: historical job cards remain NULL and fall back to the
-- existing 'INT' default when the RO is pushed. The value is a code from the
-- job_types lookup cache — never a hardcoded/guessed value.
--
-- Additive + idempotent + backward compatible: nullable column, existing rows
-- unchanged.

ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "job_type" varchar(50);
