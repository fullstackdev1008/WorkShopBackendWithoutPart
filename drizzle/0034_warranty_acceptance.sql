-- Phase 4 Step 8 — Acceptance provenance on job_cards. Additive + idempotent.
--   accepted_by        the staff member who accepted on the customer's behalf
--                      (e.g. a warranty clerk); NULL when the customer approved
--                      via the public link.
--   acceptance_channel CUSTOMER_LINK (public token) vs STAFF (in-app).
-- Provenance only — does not change approval semantics. Existing rows stay NULL
-- (interpreted as legacy / customer-link acceptance).

DO $$ BEGIN
  CREATE TYPE "public"."acceptance_channel" AS ENUM('CUSTOMER_LINK', 'STAFF');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "accepted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "acceptance_channel" "acceptance_channel";
