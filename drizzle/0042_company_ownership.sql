-- Phase 3 — Company ownership for multi-company (10EC / 20EC) search correctness.
--
-- 1) `companies`: dealership registry. Single source of truth for the company
--    selector (FE dropdown + BE interface-code allowlist) and the Evolve
--    InterfaceCode used for company-scoped lookups.
-- 2) `vehicles.owning_company_id`: the company a VIN belongs to in Evolve
--    (a VIN exists in exactly one company). Set/refreshed on every Evolve FOUND.
-- 3) `vehicles.evolve_synced_at`: cache provenance for the mirrored record.
--
-- Fully additive + idempotent: new table, nullable columns, no data changes to
-- existing rows.

CREATE TABLE IF NOT EXISTS "companies" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"           varchar(20)  NOT NULL,
  "name"           varchar(100) NOT NULL,
  "interface_code" varchar(50)  NOT NULL,
  "is_active"      boolean      NOT NULL DEFAULT true,
  "created_at"     timestamptz  NOT NULL DEFAULT now(),
  "updated_at"     timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_companies_code"           ON "companies" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_companies_interface_code" ON "companies" ("interface_code");

-- Seed the two known dealerships. Idempotent: re-running refreshes the label.
INSERT INTO "companies" ("code", "name", "interface_code") VALUES
  ('10EC', '10EC', '95112-AGLT-10EC'),
  ('20EC', '20EC', '95112-AGLT-20EC')
ON CONFLICT ("code") DO UPDATE
  SET "interface_code" = EXCLUDED."interface_code",
      "updated_at"     = now();

-- Vehicle ownership + cache provenance.
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "owning_company_id" uuid;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "evolve_synced_at"  timestamptz;

CREATE INDEX IF NOT EXISTS "idx_vehicles_owning_company_id" ON "vehicles" ("owning_company_id");
