-- Phase 3 — Technician Enhancements
-- 1) Diagnosis phase per item (notes + photos + diagnosed_at).
-- 2) Repair photos per item (timestamped).
-- 3) Digital signature URL on item completion.
-- 4) Mid-repair parts request flag.
-- 5) technician_skills master so the SA Assign modal can rank matches.

-- Photo type covers both diagnosis and repair photos on the same table.
DO $$ BEGIN
  CREATE TYPE "jci_photo_type" AS ENUM ('DIAGNOSIS', 'REPAIR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "diagnosis_notes" text,
  ADD COLUMN IF NOT EXISTS "diagnosed_at"    timestamptz,
  ADD COLUMN IF NOT EXISTS "diagnosed_by"    uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "signature_image_url" text;

CREATE TABLE IF NOT EXISTS "job_card_item_photos" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_card_item_id" uuid NOT NULL REFERENCES "job_card_items"("id") ON DELETE CASCADE,
  "photo_type"       "jci_photo_type" NOT NULL,
  "image_url"        text NOT NULL,
  "taken_at"         timestamptz NOT NULL DEFAULT now(),
  "taken_by"         uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_jci_photos_item" ON "job_card_item_photos" ("job_card_item_id");
CREATE INDEX IF NOT EXISTS "idx_jci_photos_type" ON "job_card_item_photos" ("job_card_item_id", "photo_type");

-- Mark which part requests originated from a technician mid-repair (vs the
-- SA's pre-share request flow). Parts Manager UI can group/filter on this.
ALTER TABLE "part_requests"
  ADD COLUMN IF NOT EXISTS "requested_by_technician" boolean NOT NULL DEFAULT false;

-- technician_skills — many-to-many between users (with role=technician) and
-- repair categories (re-using Phase 2's enum, 1:1 mapping).
CREATE TABLE IF NOT EXISTS "technician_skills" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "technician_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "skill"         "repair_category" NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_tech_skill" UNIQUE ("technician_id", "skill")
);

CREATE INDEX IF NOT EXISTS "idx_tech_skills_tech" ON "technician_skills" ("technician_id");
CREATE INDEX IF NOT EXISTS "idx_tech_skills_skill" ON "technician_skills" ("skill");

-- Seed default skills for the demo technicians so the Match chip lights up
-- on day one. Safe to re-run.
INSERT INTO "technician_skills" ("technician_id", "skill")
SELECT u.id, s::"repair_category"
FROM "users" u
JOIN "roles" r ON r.id = u.role_id
CROSS JOIN (VALUES ('ENGINE'), ('BRAKES'), ('OTHER')) AS s(s)
WHERE r.slug = 'technician' AND u.username = 'tech1'
ON CONFLICT DO NOTHING;

INSERT INTO "technician_skills" ("technician_id", "skill")
SELECT u.id, s::"repair_category"
FROM "users" u
JOIN "roles" r ON r.id = u.role_id
CROSS JOIN (VALUES ('TRANSMISSION'), ('ELECTRICAL'), ('OTHER')) AS s(s)
WHERE r.slug = 'technician' AND u.username = 'tech2'
ON CONFLICT DO NOTHING;

INSERT INTO "technician_skills" ("technician_id", "skill")
SELECT u.id, s::"repair_category"
FROM "users" u
JOIN "roles" r ON r.id = u.role_id
CROSS JOIN (VALUES ('BODY'), ('AC'), ('OTHER')) AS s(s)
WHERE r.slug = 'technician' AND u.username = 'tech3'
ON CONFLICT DO NOTHING;
