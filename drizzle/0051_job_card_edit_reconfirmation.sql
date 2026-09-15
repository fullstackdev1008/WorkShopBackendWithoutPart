-- Edit Job Card after creation (Option A — status-preserving where possible,
-- controlled regression post-share). Two additive changes:
--
--  1. job_cards.parts_reconfirmation_required — set when an estimate-affecting
--     edit invalidates a COMPLETED parts confirmation but the status is
--     preserved (PARTS_CONFIRMED case). Blocks Share until re-confirmed; cleared
--     by checkAndConfirmJobCard when zero pending part requests remain. For the
--     post-share regression case the job-card STATUS itself drives the block, so
--     this flag stays false there.
--
--  2. job_card_edit_history — append-only audit of every edit: who, when, what
--     changed, whether it affected the estimate, any lifecycle regression, and
--     whether the customer approval was invalidated. Modelled on roStatusHistory.
--
-- Additive + idempotent. No existing behaviour changes when the flag is false.

ALTER TABLE "job_cards"
  ADD COLUMN IF NOT EXISTS "parts_reconfirmation_required" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "job_card_edit_history" (
  "id"                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_card_id"               uuid NOT NULL REFERENCES "job_cards" ("id") ON DELETE CASCADE,
  "edited_by"                 uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "estimate_affected"         boolean NOT NULL DEFAULT false,
  "reconfirmation_triggered"  boolean NOT NULL DEFAULT false,
  "approval_invalidated"      boolean NOT NULL DEFAULT false,
  "from_status"               varchar(40),
  "to_status"                 varchar(40),
  "prev_total"                numeric(12, 2),
  "new_total"                 numeric(12, 2),
  "summary"                   text,
  "edited_at"                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_job_card_edit_history_job_card"
  ON "job_card_edit_history" ("job_card_id");
