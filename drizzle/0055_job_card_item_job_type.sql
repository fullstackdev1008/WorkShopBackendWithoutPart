-- Per-job Evolve Job Type. The Job Type selection moved from card-level
-- (job_cards.job_type) to per-job, so each job can carry its own <JobType> in
-- its <ROJobHeader> block. Stored per item (all items of a job share the value),
-- mirroring job_group. job_cards.job_type is retained (holds the first job's
-- type) for backward compatibility and the single-block RO fallback.
--
-- Additive + idempotent + nullable: existing rows stay NULL and fall back to the
-- proven 'INT' default at RO push.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "job_type" varchar(50);
