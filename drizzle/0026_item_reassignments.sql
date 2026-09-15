-- Reassignment audit. One row per "tech A → tech B" handover on a single
-- job-card item, with the actor, reason, and tech-A's accumulated time at
-- the moment of the swap. Drives the Vehicle 360 timeline entry and the
-- receiving tech's "inheritance" banner.

CREATE TABLE IF NOT EXISTS "job_card_item_reassignments" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_card_item_id"  uuid NOT NULL REFERENCES "job_card_items"("id") ON DELETE CASCADE,
  "from_tech_id"      uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "to_tech_id"        uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reassigned_by"     uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason"            text,
  "prior_seconds"     integer NOT NULL DEFAULT 0,
  "reassigned_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_jci_reassign_item" ON "job_card_item_reassignments" ("job_card_item_id");
CREATE INDEX IF NOT EXISTS "idx_jci_reassign_at"   ON "job_card_item_reassignments" ("reassigned_at");
