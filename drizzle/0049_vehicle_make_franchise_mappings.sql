-- AI-3 — Vehicle-make → Franchise mapping (client-configurable).
--
-- Repository investigation proved Evolve exposes only FranchiseSeqID + SDNumber
-- (both opaque integers) for FranchiseServiceDepartments, with NO franchise
-- name / make / brand / dealer field on any API. Therefore a vehicle make
-- (e.g. FAW) CANNOT be mapped to a FranchiseSeqID automatically. This table
-- holds the mapping the CLIENT must provide. It starts EMPTY — no FranchiseSeqID
-- values are seeded or guessed. Until the client populates it, RO creation keeps
-- its existing '1' / '1' fallback (see resolveRoFranchise / evolveIrm builder).
--
--   • vehicle_make      — matches vehicles.brand (case-insensitive at resolve time)
--   • franchise_seq_id  — client-supplied Evolve FranchiseSeqID (RO <FranchiseSeqID>)
--   • service_dept      — client-supplied Evolve SDNumber      (RO <ServiceDept>)
--   • company_id        — optional: scope a make to a franchise PER company
--                         (10EC / 20EC). NULL = global mapping for the make.
--
-- Additive + idempotent: new table only, no changes to existing rows.

CREATE TABLE IF NOT EXISTS "vehicle_make_franchise_mappings" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"       uuid        REFERENCES "companies" ("id") ON DELETE CASCADE,
  "vehicle_make"     varchar(100) NOT NULL,
  "franchise_seq_id" varchar(20)  NOT NULL,
  "service_dept"     varchar(20)  NOT NULL,
  "is_active"        boolean      NOT NULL DEFAULT true,
  "created_at"       timestamptz  NOT NULL DEFAULT now(),
  "updated_at"       timestamptz  NOT NULL DEFAULT now()
);

-- Uniqueness is enforced on lower(vehicle_make) so it MATCHES the application's
-- case-insensitive lookup (repository resolves via lower(vehicle_make)). A
-- case-sensitive index would allow "FAW" + "faw" as two rows, which resolve()
-- would then see as ambiguous — this closes that gap at the DB level. Postgres
-- treats NULL company_id as distinct, so global rows need their own partial
-- index. Both are functional (expression) indexes, so they are defined here in
-- SQL rather than via Drizzle. DROP guards make this idempotent and corrective
-- even if an earlier case-sensitive version of these indexes was applied.
DROP INDEX IF EXISTS "uq_vehicle_make_franchise_company_make";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_make_franchise_company_make"
  ON "vehicle_make_franchise_mappings" ("company_id", lower("vehicle_make"))
  WHERE "company_id" IS NOT NULL;

DROP INDEX IF EXISTS "uq_vehicle_make_franchise_global_make";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_make_franchise_global_make"
  ON "vehicle_make_franchise_mappings" (lower("vehicle_make"))
  WHERE "company_id" IS NULL;
