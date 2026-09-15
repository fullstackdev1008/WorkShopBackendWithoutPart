-- Multi-job RO support: persist which job (within the job card) each item
-- belongs to. The create/edit flow flattens body.jobs → job_card_items and
-- previously discarded the job grouping, so the RO sync could only merge every
-- item's description into a single ROJobHeader/CustomerStates. This 1-based
-- index restores the grouping so the sync can emit one <RowDetails> per job.
--
-- Additive + idempotent. Default 1 backfills every existing row to "job 1",
-- which reproduces today's single-block behaviour exactly — no data change and
-- no behaviour change until EVOLVE_RO_MULTI_JOB_ENABLED is switched on.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "job_group" integer NOT NULL DEFAULT 1;
