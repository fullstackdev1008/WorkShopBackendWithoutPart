-- Labour line "Notes" persistence (Phase 2 — Labour section).
--
-- job_card_items has no generic notes column (completion_notes / diagnosis_notes
-- belong to the technician workflow). This adds a single nullable column so the
-- Labour section's Notes field can be saved. Additive + idempotent; existing
-- rows stay NULL. No item_kind, no other schema change.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "notes" varchar(500);
