-- Phase: Evolve full-payload persistence.
-- Adds the few missing columns to customers and vehicles so every field
-- IRM_Customer_VehicleLookup returns can be stored. All additive.
-- The AR account table already exists from 0018_customer_ar.sql.

-- ─── customers ─────────────────────────────────────────────────────────────
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "passport_number"    varchar(20),
  ADD COLUMN IF NOT EXISTS "oem_customer_type"  varchar(20);

-- ─── vehicles ──────────────────────────────────────────────────────────────
ALTER TABLE "vehicles"
  ADD COLUMN IF NOT EXISTS "model_code"           varchar(50),
  ADD COLUMN IF NOT EXISTS "evolve_selling_date"  date;
