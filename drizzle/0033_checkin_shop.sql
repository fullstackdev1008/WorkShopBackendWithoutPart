-- Phase 4 Step 2 — Record-level shop marker on vehicle_check_ins. Additive +
-- idempotent. Set at gate entry (confirm-entry); the entire downstream flow
-- (job cards, allocations, QC, washbay) derives its shop from this column.
-- Reuses the existing bay_category enum (SERVICE / MAJOR / PDI), created in
-- 0031. Nullable so existing rows remain valid until backfilled (Phase 6).

ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "shop" "bay_category";

CREATE INDEX IF NOT EXISTS "idx_vehicle_check_ins_shop" ON "vehicle_check_ins" ("shop");
