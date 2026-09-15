-- AI-3 — FranchiseServiceDepartments lookup cache (Part A infrastructure).
--
-- Cache of the Evolve IRM_GetLookupDropdownTables `FranchiseServiceDepartments`
-- table. Only the two confirmed fields are stored (per the apitest schema
-- annotations): FranchiseSeqID and SDNumber (SDNumber maps to RO <ServiceDept>).
-- No franchise-name / make / company column — none is confirmed to exist.
--
-- Populated by masterDataSync when the lookup is fetched; the parser is
-- fail-safe (no rows persisted if the live response structure differs from the
-- expected <RowDetails> shape). This does NOT change RO XML behaviour —
-- FranchiseSeqID / ServiceDept still default to '1' until resolveRoFranchise()
-- gains a deterministic selection rule.
--
-- Additive + idempotent: new table only, no changes to existing rows.

CREATE TABLE IF NOT EXISTS "franchise_service_departments" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "franchise_seq_id" varchar(20) NOT NULL,
  "sd_number"        varchar(20) NOT NULL,
  "is_active"        boolean     NOT NULL DEFAULT true,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_franchise_service_departments_seq_sd"
  ON "franchise_service_departments" ("franchise_seq_id", "sd_number");
