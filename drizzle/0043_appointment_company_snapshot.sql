-- Phase B2 — appointments.company_id (snapshot only).
--
-- Records which company an appointment was booked under, for reporting/context.
-- NOT authoritative for vehicle ownership (that is vehicles.owning_company_id).
-- Additive + idempotent: nullable column, no changes to existing rows.
--
-- FK ON DELETE SET NULL — companies are deactivated (is_active=false), not
-- deleted; if one were ever removed, the snapshot simply nulls out.

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_appointments_company_id" ON "appointments" ("company_id");
