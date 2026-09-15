-- qc_out_checklist accumulates duplicates because 0017's ON CONFLICT DO
-- NOTHING never triggers (no unique key on label). This:
--   1. Deletes the orphan duplicates (keeps the earliest row per label).
--   2. Adds a unique constraint on label so future re-runs are truly idempotent.

DELETE FROM "qc_out_checklist" a
USING "qc_out_checklist" b
WHERE a.label = b.label
  AND a.created_at > b.created_at;

DO $$ BEGIN
  ALTER TABLE "qc_out_checklist"
    ADD CONSTRAINT "uq_qc_out_checklist_label" UNIQUE ("label");
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN duplicate_table THEN NULL;
END $$;
