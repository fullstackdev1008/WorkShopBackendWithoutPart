-- Captures who (SA) assigned the technician to a job item. Distinct from
-- job_cards.updated_by, which gets overwritten by every later action.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "assigned_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
