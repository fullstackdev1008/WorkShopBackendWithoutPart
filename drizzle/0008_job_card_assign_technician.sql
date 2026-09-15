-- Assign-technician feature on job cards:
--   1. Adds IN_PROGRESS to job_card_status enum (the post-customer-approval,
--      pre-completion state while a technician is actively working).
--   2. Adds job_card_priority enum.
--   3. Adds columns on job_cards for technician assignment.
ALTER TYPE "job_card_status" ADD VALUE IF NOT EXISTS 'IN_PROGRESS' BEFORE 'IN_SERVICE';

DO $$ BEGIN
  CREATE TYPE "job_card_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "job_cards"
  ADD COLUMN IF NOT EXISTS "assigned_technician_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "estimated_hours" numeric(6, 2),
  ADD COLUMN IF NOT EXISTS "priority" "job_card_priority",
  ADD COLUMN IF NOT EXISTS "assigned_at" timestamptz;
