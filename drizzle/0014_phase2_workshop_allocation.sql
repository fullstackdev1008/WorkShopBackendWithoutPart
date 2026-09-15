-- Phase 2 — Workshop Allocation
-- 1) Two new enums: workshop_priority + repair_category.
-- 2) workshop_bays master (per-workshop list of physical bays).
-- 3) workshop_allocations log (one row per allocation event; re-allocation
--    creates a new row with superseded_by pointing back).
-- 4) Foreman role for the workshop allocation dashboard.
-- 5) Seed 5 starter bays so the FE has something to render out of the box.

DO $$ BEGIN
  CREATE TYPE "workshop_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "repair_category" AS ENUM (
    'ENGINE', 'TRANSMISSION', 'ELECTRICAL', 'BRAKES', 'BODY', 'AC', 'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "workshop_bays" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bay_no"                 varchar(20)  NOT NULL UNIQUE,
  "location"               varchar(100),
  "capabilities"           text[]       NOT NULL DEFAULT '{}',
  "is_active"              boolean      NOT NULL DEFAULT true,
  -- Set to the current open allocation when occupied; nullable when free.
  "current_allocation_id"  uuid,
  "created_at"             timestamptz  NOT NULL DEFAULT now(),
  "updated_at"             timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "workshop_allocations" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "check_in_id"     uuid NOT NULL REFERENCES "vehicle_check_ins"("id") ON DELETE CASCADE,
  "bay_id"          uuid NOT NULL REFERENCES "workshop_bays"("id"),
  "priority"        "workshop_priority" NOT NULL DEFAULT 'MEDIUM',
  "repair_category" "repair_category"   NOT NULL DEFAULT 'OTHER',
  "notes"           text,
  "allocated_by"    uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "allocated_at"    timestamptz NOT NULL DEFAULT now(),
  -- NULL = still in this bay; set when bay is freed (QC Out, re-entry, cancel).
  "released_at"     timestamptz,
  -- Set when re-allocating; the new row carries the link back to the prior.
  "superseded_by"   uuid REFERENCES "workshop_allocations"("id")
);

CREATE INDEX IF NOT EXISTS "idx_allocations_check_in" ON "workshop_allocations" ("check_in_id");
CREATE INDEX IF NOT EXISTS "idx_allocations_bay"      ON "workshop_allocations" ("bay_id");
-- Partial unique index: at most ONE open allocation per check-in.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_allocation_open_per_checkin"
  ON "workshop_allocations" ("check_in_id")
  WHERE "released_at" IS NULL;

-- FK back-pointer (deferred — both tables already exist).
DO $$ BEGIN
  ALTER TABLE "workshop_bays"
    ADD CONSTRAINT "fk_bay_current_allocation"
    FOREIGN KEY ("current_allocation_id")
    REFERENCES "workshop_allocations"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Seed: 5 starter bays. Safe to re-run (ON CONFLICT DO NOTHING).
INSERT INTO "workshop_bays" ("bay_no", "location", "capabilities")
VALUES
  ('Bay 1', 'Block A',  ARRAY['ENGINE','OTHER']::text[]),
  ('Bay 2', 'Block A',  ARRAY['TRANSMISSION','ENGINE']::text[]),
  ('Bay 3', 'Block B',  ARRAY['BRAKES','OTHER']::text[]),
  ('Bay 4', 'Block B',  ARRAY['ELECTRICAL','AC']::text[]),
  ('Bay 5', 'Block C',  ARRAY['BODY','OTHER']::text[])
ON CONFLICT ("bay_no") DO NOTHING;

-- Seed: Foreman role (the actual permissions are added by seed.ts so it
-- stays in sync with the rest of the role catalogue).
INSERT INTO "roles" ("name", "slug") VALUES ('Foreman', 'foreman')
ON CONFLICT ("slug") DO NOTHING;
