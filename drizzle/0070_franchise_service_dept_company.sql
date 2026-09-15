-- Company scoping for the Franchise / Service-Dept cache.
--
-- WHY: the pairs come from IRM_GetLookupDropdownTables, which is answered per
-- InterfaceCode — i.e. per company (10EC / 20EC). The cache had no company
-- column, so one sync's rows were shown to every company and an advisor could
-- pick a franchise belonging to the other dealership. The RO push already
-- resolves its InterfaceCode from vehicles.owning_company_id
-- (resolveRoInterfaceCode), so the dropdown must be filtered by the same key or
-- the two disagree.
--
-- NULL company_id = "unscoped": rows from the pre-existing single-company sync.
-- They are deliberately NOT back-filled to a guessed company — nothing in the
-- data records which InterfaceCode produced them. The API treats NULL as
-- visible to every company, so the dropdown keeps working exactly as today
-- until a per-company sync runs and supersedes them.
--
-- Additive + idempotent: new nullable column, index rebuild only.

ALTER TABLE "franchise_service_departments"
  ADD COLUMN IF NOT EXISTS "company_id" uuid REFERENCES "companies" ("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_franchise_service_departments_company_id"
  ON "franchise_service_departments" ("company_id");

-- The old key (franchise_seq_id, sd_number) is wrong once rows are per company:
-- 10EC and 20EC may legitimately both return the pair (1, 1) with different
-- labels. Replace it with a company-qualified key.
DROP INDEX IF EXISTS "uq_franchise_service_departments_seq_sd";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_franchise_service_departments_company_seq_sd"
  ON "franchise_service_departments" ("company_id", "franchise_seq_id", "sd_number");

-- Postgres treats NULLs as distinct in a unique index, so the unscoped legacy
-- rows need their own partial index to stay de-duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_franchise_service_departments_global_seq_sd"
  ON "franchise_service_departments" ("franchise_seq_id", "sd_number")
  WHERE "company_id" IS NULL;
