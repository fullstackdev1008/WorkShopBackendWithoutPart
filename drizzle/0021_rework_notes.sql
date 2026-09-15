-- Rework loop — when QC-Out FAILs a completed item, the foreman reopens it
-- via "Send for Rework" on the foreman dashboard. We capture the inspector's
-- explanation (and any extra foreman briefing) here so the technician sees
-- exactly what to fix, separate from the tech's own completionNotes.

ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "rework_notes" text,
  ADD COLUMN IF NOT EXISTS "rework_count" integer NOT NULL DEFAULT 0;

-- rework_count helps the foreman UI flag items that have failed QC ≥2 times
-- (the "stubbornly same tech" anti-pattern guard).
