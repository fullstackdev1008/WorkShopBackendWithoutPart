-- Backoff / retry bookkeeping for Job Card → Evolve RO sync. Additive + nullable.
-- Existing rows default to attempt_count 0 and next_attempt_at NULL (eligible
-- immediately). Used by the reconcile sweep to apply exponential backoff and to
-- park a row as NEEDS_MANUAL once EVOLVE_RO_MAX_ATTEMPTS is reached.
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "evolve_attempt_count" integer DEFAULT 0;
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "evolve_next_attempt_at" timestamp with time zone;
