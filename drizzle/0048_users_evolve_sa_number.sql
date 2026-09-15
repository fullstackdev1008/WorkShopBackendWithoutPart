-- Gap 4 — per-user Evolve ServiceAdvisorNumber mapping.
--
-- Stores the Evolve ServiceAdvisors.SANumber for a user; resolved at RO-sync
-- time to populate <ServiceAdvisorNumber> on IRM_ROMaintenance. NULL for
-- non-advisors and unmapped advisors → the RO falls back to the existing '1'
-- default. Soft reference only (Evolve is external; no FK).
--
-- Additive + idempotent + backward compatible: nullable column, no backfill,
-- existing rows unchanged.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "evolve_sa_number" integer;

-- One Evolve service advisor maps to at most one local user (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_evolve_sa_number"
  ON "users" ("evolve_sa_number")
  WHERE "evolve_sa_number" IS NOT NULL;
