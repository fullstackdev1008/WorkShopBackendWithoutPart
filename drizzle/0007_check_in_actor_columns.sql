-- Capture per-visit actor on vehicle_check_ins so visit-history can attribute
-- gate-entry / close events to the user who performed them. Existing rows
-- remain NULL — there is no historical actor to backfill.
ALTER TABLE "vehicle_check_ins"
  ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
