-- Dormant infrastructure for future Job Card → Evolve (IRM_ROMaintenance) sync.
-- Additive + idempotent. All columns are NULLABLE and unused while
-- EVOLVE_JOB_CARD_SYNC_ENABLED is false (the default) — existing rows stay NULL
-- and no existing query, API response, or behaviour depends on them.
--   evolve_ro_number   Evolve DMSReferenceNo (=RONumber); authoritative key for
--                      UPDATE/lookup. NULL ⇒ never created in Evolve.
--   evolve_crm_ro_ref  our correlation ref (sent later as CRMReferenceNo).
--   evolve_sync_status PENDING | SYNCED | FAILED | DEFERRED.
--   evolve_synced_at   last successful push.  evolve_last_error  last failure.

DO $$ BEGIN
  CREATE TYPE "public"."evolve_sync_status" AS ENUM('PENDING', 'SYNCED', 'FAILED', 'DEFERRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "evolve_ro_number" varchar(20);
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "evolve_crm_ro_ref" varchar(32);
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "evolve_sync_status" "evolve_sync_status";
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "evolve_synced_at" timestamp with time zone;
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "evolve_last_error" text;
