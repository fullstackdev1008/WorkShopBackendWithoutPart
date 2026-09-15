-- Technician profile attributes on users: Ability + Designation. Additive,
-- idempotent, and NULLABLE — only meaningful for users with role = technician,
-- and left NULL for everyone else, so existing rows and behaviour are unchanged.
--   ability      Decimal 0.00–1.00 (informational only; never sent to Evolve).
--   designation  Fixed job-grade enum (NOT a role; roles control permissions).

DO $$ BEGIN
  CREATE TYPE "public"."technician_designation" AS ENUM (
    'SERVICE_MECHANIC', 'MAJOR_SHOP_MECHANIC', 'REPAIR_SHOP_ASSISTANT', 'APPRENTICE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ability" numeric(3, 2);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "designation" "technician_designation";
