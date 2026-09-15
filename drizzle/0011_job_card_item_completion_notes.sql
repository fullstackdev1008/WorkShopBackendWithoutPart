-- Free-form comments captured when a technician marks a job item complete.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "completion_notes" text;
