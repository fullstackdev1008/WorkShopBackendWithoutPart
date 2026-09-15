-- Manual Part Price Override (TrueGear-only; never pushed to Evolve).
--
-- parts_cost continues to hold the EFFECTIVE unit price (manual ?? evolve), so
-- all existing estimate / invoice / tax / total / PDF logic keeps working. These
-- columns preserve the original Evolve price and track the override:
--   evolve_unit_price   — original price from Evolve / auto-load (preserved)
--   manual_unit_price   — the SA's override; NULL → use evolve_unit_price
--   is_price_overridden — true when a manual price is in effect
--
-- Additive + idempotent + backward compatible: existing rows get NULL prices and
-- is_price_overridden = false, and continue to read parts_cost as before.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "evolve_unit_price" numeric(12,2);
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "manual_unit_price" numeric(12,2);
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "is_price_overridden" boolean NOT NULL DEFAULT false;
