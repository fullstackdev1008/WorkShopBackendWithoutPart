-- Per-item time tracking for technicians. Each row is one "session" of work:
-- started_at is when the timer was started, paused_at is when it was paused
-- (NULL while running). Total time on an item = SUM(paused_at - started_at).
CREATE TABLE IF NOT EXISTS "job_card_item_time_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_card_item_id" uuid NOT NULL REFERENCES "job_card_items"("id") ON DELETE CASCADE,
  "technician_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "paused_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_jci_time_logs_item_id" ON "job_card_item_time_logs" ("job_card_item_id");
CREATE INDEX IF NOT EXISTS "idx_jci_time_logs_technician_id" ON "job_card_item_time_logs" ("technician_id");
-- At most one open (running) session per item — paused_at IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_jci_time_logs_open_per_item"
  ON "job_card_item_time_logs" ("job_card_item_id")
  WHERE "paused_at" IS NULL;

ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "completed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "completed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
