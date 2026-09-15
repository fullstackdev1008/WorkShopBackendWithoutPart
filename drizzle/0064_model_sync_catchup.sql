-- Catch-up migration: columns that existed only in src/db/models (applied to
-- local/UAT via `db:push`) and had no migration file, so a freshly-pointed
-- DATABASE_URL (Supabase) was missing them and threw 42703 at runtime.
-- All additive + idempotent + nullable — existing rows are untouched.

-- ── Photo geotagging (vehicle_images, vehicle_check_in_photos) ──────────────
-- Captured client-side at shutter time; captured_at proves the photo wasn't a
-- gallery pick.
ALTER TABLE "vehicle_images"
  ADD COLUMN IF NOT EXISTS "gps_lat"           numeric(10, 7),
  ADD COLUMN IF NOT EXISTS "gps_lng"           numeric(10, 7),
  ADD COLUMN IF NOT EXISTS "gps_accuracy_m"    integer,
  ADD COLUMN IF NOT EXISTS "captured_at"       timestamptz,
  ADD COLUMN IF NOT EXISTS "device_user_agent" varchar(255),
  ADD COLUMN IF NOT EXISTS "address_text"      varchar(500);

ALTER TABLE "vehicle_check_in_photos"
  ADD COLUMN IF NOT EXISTS "gps_lat"           numeric(10, 7),
  ADD COLUMN IF NOT EXISTS "gps_lng"           numeric(10, 7),
  ADD COLUMN IF NOT EXISTS "gps_accuracy_m"    integer,
  ADD COLUMN IF NOT EXISTS "captured_at"       timestamptz,
  ADD COLUMN IF NOT EXISTS "device_user_agent" varchar(255),
  ADD COLUMN IF NOT EXISTS "address_text"      varchar(500);

-- ── Foreman review / sign-off (job_cards) ──────────────────────────────────
-- Last technician item completing moves the card to FOREMAN_REVIEW; the foreman
-- signs off (→ COMPLETED, eligible for QC Out) or rejects (→ IN_PROGRESS).
-- Signature is a base64 data URL (tens of KB) → text, not varchar.
ALTER TABLE "job_cards"
  ADD COLUMN IF NOT EXISTS "foreman_signed_off_by"    uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "foreman_signed_off_at"    timestamptz,
  ADD COLUMN IF NOT EXISTS "foreman_signature_url"    text,
  ADD COLUMN IF NOT EXISTS "foreman_rejection_reason" text,
  ADD COLUMN IF NOT EXISTS "foreman_rejected_at"      timestamptz;

-- ── QC Out item structure mirrored from QC In (qc_out_inspection_items) ────
-- category/sub_category/item_code mirror the QC In shape so comparison joins
-- are direct; qc_in_item_id points at the matching QC In row (NULL when the
-- master gained an item between QC In and QC Out).
ALTER TABLE "qc_out_inspection_items"
  ADD COLUMN IF NOT EXISTS "category"      "qc_category",
  ADD COLUMN IF NOT EXISTS "sub_category"  varchar(100),
  ADD COLUMN IF NOT EXISTS "item_code"     varchar(50),
  ADD COLUMN IF NOT EXISTS "qc_in_item_id" uuid REFERENCES "qc_inspection_items"("id") ON DELETE SET NULL;

-- ── Technician accept / reject of a part handover (part_requests) ──────────
-- Acceptance confirms physical handover; rejection (e.g. wrong part) bounces
-- the request back to the parts-manager queue with a reason.
ALTER TABLE "part_requests"
  ADD COLUMN IF NOT EXISTS "accepted_at"       timestamptz,
  ADD COLUMN IF NOT EXISTS "accepted_by"       uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "tech_rejected_at"  timestamptz,
  ADD COLUMN IF NOT EXISTS "tech_rejected_by"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "rejection_reason"  varchar(500);
