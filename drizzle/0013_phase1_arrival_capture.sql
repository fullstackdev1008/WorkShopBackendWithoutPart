-- Phase 1 — Capture + Status Foundation
-- 1) Receiving number sequence used by gate entry to generate RCV-NNNNN.
-- 2) Richer arrival capture columns on vehicle_check_ins.
-- 3) Canonical ro_status column on vehicle_check_ins + a tamper-evident
--    history table. setRoStatus() is the only writer going forward.
-- 4) DAMAGE photo type for the gate-entry damage photo set.
-- 5) Initial backfill of ro_status from existing vehicles.status so the new
--    column isn't NULL for in-progress visits.

CREATE SEQUENCE IF NOT EXISTS "recv_seq" START 1;

DO $$ BEGIN
  CREATE TYPE "fuel_level" AS ENUM ('EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "vehicle_photo_type" ADD VALUE IF NOT EXISTS 'DAMAGE' BEFORE 'OTHER';

ALTER TABLE "vehicle_check_ins"
  ADD COLUMN IF NOT EXISTS "receiving_no" varchar(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS "driver_name" varchar(150),
  ADD COLUMN IF NOT EXISTS "driver_phone" varchar(30),
  ADD COLUMN IF NOT EXISTS "driver_licence_no" varchar(50),
  ADD COLUMN IF NOT EXISTS "fuel_level" "fuel_level",
  ADD COLUMN IF NOT EXISTS "damages_notes" text,
  ADD COLUMN IF NOT EXISTS "complaint_text" text,
  ADD COLUMN IF NOT EXISTS "ro_status" varchar(40),
  ADD COLUMN IF NOT EXISTS "ro_status_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "ro_status_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "ro_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "check_in_id" uuid NOT NULL REFERENCES "vehicle_check_ins"("id") ON DELETE CASCADE,
  "from_status" varchar(40),
  "to_status" varchar(40) NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  "by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text
);

CREATE INDEX IF NOT EXISTS "idx_ro_status_history_check_in_id" ON "ro_status_history" ("check_in_id");
CREATE INDEX IF NOT EXISTS "idx_ro_status_history_at" ON "ro_status_history" ("at");

-- Backfill ro_status for existing check-ins by mapping the linked vehicle's
-- legacy status to the canonical 15-state flow. Only fills rows where
-- ro_status is still NULL so this is safe to re-run.
UPDATE "vehicle_check_ins" vci
SET "ro_status" = CASE v."status"
    WHEN 'Entry (Draft)'                       THEN 'ARRIVED'
    WHEN 'Vehicle IN'                          THEN 'ARRIVED'
    WHEN 'Inspection (Draft)'                  THEN 'QC_CHECK_IN'
    WHEN 'Inspection Done'                     THEN 'IN_WORKSHOP'
    WHEN 'Job Card (Draft)'                    THEN 'DIAGNOSING'
    WHEN 'Job Card (Pending Parts Approval)'   THEN 'WAITING_FOR_PARTS'
    WHEN 'Job Card (Parts Approval Done)'      THEN 'AWAITING_APPROVAL'
    WHEN 'Job Card (Pending Cust. Approval)'   THEN 'AWAITING_APPROVAL'
    WHEN 'Job Card (Partial Cust. Approval)'   THEN 'AWAITING_APPROVAL'
    WHEN 'Job Card (Full Cust. Approval)'      THEN 'APPROVED'
    WHEN 'In Service'                          THEN 'REPAIRS_STARTED'
    WHEN 'Ready for Billing'                   THEN 'READY_FOR_RELEASE'
    WHEN 'Completed'                           THEN 'RELEASED'
    WHEN 'Cancelled'                           THEN 'CLOSED'
    WHEN 'Archived'                            THEN 'CLOSED'
    ELSE 'ARRIVED'
  END,
  "ro_status_at" = COALESCE("ro_status_at", vci."updated_at", vci."check_in_time")
FROM "vehicles" v
WHERE vci."vehicle_id" = v."id"
  AND vci."ro_status" IS NULL;
