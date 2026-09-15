-- Phase 6 — Warranty Store
-- A warranty part is a replaced part the OEM may want to inspect before
-- approving the customer's warranty claim. This phase keeps a tagged
-- inventory of those parts with a clean status flow:
--   HELD → PENDING_APPROVAL → APPROVED → SCRAPPED (or REJECTED).
-- Independent of the RO lifecycle — a tagged part stays on the shelf long
-- after the customer drives away.

DO $$ BEGIN
  CREATE TYPE "warranty_status" AS ENUM (
    'HELD', 'PENDING_APPROVAL', 'APPROVED', 'SCRAPPED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tag-no sequence: server-generated, monotonic, "WT-NNNNN" once formatted.
CREATE SEQUENCE IF NOT EXISTS "wt_seq" START 1;

-- Per-line warranty flag captured by the SA at job-card creation. Tech's
-- completion of a flagged item auto-creates the warranty_parts row.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "is_warranty_claim"  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "warranty_claim_no"  varchar(60),
  ADD COLUMN IF NOT EXISTS "warranty_oem"       varchar(120);

CREATE TABLE IF NOT EXISTS "warranty_parts" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tag_no"             varchar(20) NOT NULL UNIQUE,
  "job_card_item_id"   uuid REFERENCES "job_card_items"("id") ON DELETE SET NULL,
  "vehicle_id"         uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "customer_id"        uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "part_name"          text NOT NULL,
  "part_number"        text,
  "warranty_claim_no"  varchar(60),
  "warranty_oem"       varchar(120),
  "technician_id"      uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "removed_at"         timestamptz NOT NULL DEFAULT now(),
  "status"             "warranty_status" NOT NULL DEFAULT 'HELD',
  "approval_doc_url"   text,
  "approved_at"        timestamptz,
  "approved_by"        uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "scrapped_at"        timestamptz,
  "scrapped_by"        uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "notes"              text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_warranty_status"    ON "warranty_parts" ("status");
CREATE INDEX IF NOT EXISTS "idx_warranty_vehicle"   ON "warranty_parts" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_warranty_customer"  ON "warranty_parts" ("customer_id");
CREATE INDEX IF NOT EXISTS "idx_warranty_removed"   ON "warranty_parts" ("removed_at");
