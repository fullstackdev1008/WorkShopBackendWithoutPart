-- Designation master: replace the fixed `technician_designation` enum with an
-- admin-managed table. Fully data-preserving + idempotent:
--   1. create the designations table (+ case-insensitive unique name),
--   2. seed the four previously-enumerated values,
--   3. add users.designation_id FK,
--   4. backfill each user's enum value into the FK,
--   5. drop the old enum column + type ONLY after backfill.

CREATE TABLE IF NOT EXISTS "designations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on name.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_designations_name_ci" ON "designations" (lower("name"));

-- Seed the values that previously existed as enum labels (no-op on re-run).
INSERT INTO "designations" ("name") VALUES
  ('Service Mechanic'),
  ('Major Shop Mechanic'),
  ('Repair Shop Assistant'),
  ('Apprentice')
ON CONFLICT DO NOTHING;

-- FK column (nullable; ON DELETE SET NULL so a removed designation never breaks users).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "designation_id" uuid;
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_designation_id_designations_id_fk"
    FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Backfill from the old enum column (only if it still exists), then drop it.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'designation'
  ) THEN
    UPDATE "users" u
    SET "designation_id" = d.id
    FROM "designations" d
    WHERE u."designation" IS NOT NULL
      AND u."designation_id" IS NULL
      AND d."name" = CASE u."designation"::text
        WHEN 'SERVICE_MECHANIC'      THEN 'Service Mechanic'
        WHEN 'MAJOR_SHOP_MECHANIC'   THEN 'Major Shop Mechanic'
        WHEN 'REPAIR_SHOP_ASSISTANT' THEN 'Repair Shop Assistant'
        WHEN 'APPRENTICE'            THEN 'Apprentice'
      END;

    ALTER TABLE "users" DROP COLUMN "designation";
  END IF;
END $$;

DROP TYPE IF EXISTS "technician_designation";
