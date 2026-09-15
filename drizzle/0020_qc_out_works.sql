-- QC Out — per-item Works Completed verification.
-- Inspector ticks every completed job-card item PASS/FAIL/NA before signing
-- the vehicle out. Stored per inspection (not per job-card item lifetime)
-- because a single item can be re-verified across multiple QC-out attempts
-- after rework loops.

CREATE TABLE IF NOT EXISTS "qc_out_work_verifications" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "qc_out_inspection_id" uuid REFERENCES "qc_out_inspections"("id") ON DELETE CASCADE,
  "check_in_id"          uuid NOT NULL REFERENCES "vehicle_check_ins"("id") ON DELETE CASCADE,
  "job_card_item_id"     uuid NOT NULL REFERENCES "job_card_items"("id") ON DELETE CASCADE,
  "result"               varchar(10),                        -- PASS / FAIL / NA / null
  "notes"                text,
  "verified_at"          timestamptz,
  "verified_by"          uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qc_out_work_verif_inspection" ON "qc_out_work_verifications" ("qc_out_inspection_id");
CREATE INDEX IF NOT EXISTS "idx_qc_out_work_verif_check_in"   ON "qc_out_work_verifications" ("check_in_id");
CREATE INDEX IF NOT EXISTS "idx_qc_out_work_verif_item"       ON "qc_out_work_verifications" ("job_card_item_id");
