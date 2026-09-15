-- Phase 5 — QC Out & Washbay
-- One table per concept (inspection / items / photos) plus a small editable
-- checklist master so the client can tune the list without code changes.
-- RO transitions reuse Phase 1's setRoStatus chokepoint.

DO $$ BEGIN
  CREATE TYPE "qc_out_overall" AS ENUM ('PASS', 'FAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "qc_out_item_status" AS ENUM ('PASS', 'FAIL', 'NA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "qc_out_checklist" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label"      text NOT NULL,
  "sort_order" int NOT NULL DEFAULT 0,
  "is_active"  boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "qc_out_inspections" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "check_in_id"          uuid NOT NULL REFERENCES "vehicle_check_ins"("id") ON DELETE CASCADE,
  "overall_status"       "qc_out_overall" NOT NULL,
  "final_remarks"        text,
  "inspector_id"         uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "signature_image_url"  text,
  "started_at"           timestamptz NOT NULL DEFAULT now(),
  "completed_at"         timestamptz NOT NULL DEFAULT now(),
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qc_out_check_in" ON "qc_out_inspections" ("check_in_id");
CREATE INDEX IF NOT EXISTS "idx_qc_out_completed_at" ON "qc_out_inspections" ("completed_at");

CREATE TABLE IF NOT EXISTS "qc_out_inspection_items" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "inspection_id" uuid NOT NULL REFERENCES "qc_out_inspections"("id") ON DELETE CASCADE,
  "item_label"    text NOT NULL,
  "status"        "qc_out_item_status" NOT NULL,
  "notes"         text,
  "sort_order"    int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_qc_out_items_inspection" ON "qc_out_inspection_items" ("inspection_id");

CREATE TABLE IF NOT EXISTS "qc_out_inspection_photos" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "inspection_id" uuid NOT NULL REFERENCES "qc_out_inspections"("id") ON DELETE CASCADE,
  "item_id"       uuid REFERENCES "qc_out_inspection_items"("id") ON DELETE CASCADE,
  "image_url"     text NOT NULL,
  "taken_at"      timestamptz NOT NULL DEFAULT now(),
  "taken_by"      uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_qc_out_photos_inspection" ON "qc_out_inspection_photos" ("inspection_id");

-- Seed the default checklist. Safe to re-run.
INSERT INTO "qc_out_checklist" ("label", "sort_order") VALUES
  ('All requested work complete', 1),
  ('No leaks',                    2),
  ('Vehicle clean',               3),
  ('Customer items returned',     4),
  ('Test drive passed',           5)
ON CONFLICT DO NOTHING;
