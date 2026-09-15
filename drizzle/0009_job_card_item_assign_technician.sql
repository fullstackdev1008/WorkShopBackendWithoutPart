-- Per-item technician assignment on job card items. Replaces the job-card-
-- level columns added in 0008 (those stay for backwards compatibility but
-- are no longer the source of truth — each item carries its own technician).
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "assigned_technician_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "estimated_hours" numeric(6, 2),
  ADD COLUMN IF NOT EXISTS "priority" "job_card_priority",
  ADD COLUMN IF NOT EXISTS "assigned_at" timestamptz;
