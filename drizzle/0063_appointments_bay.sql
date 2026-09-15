-- Bay & Time-Slot scheduling — associate an appointment with a physical bay so
-- per-bay, duration-aware availability can be calculated. Nullable + additive +
-- backward compatible: existing appointments keep bay_id NULL and continue to
-- use the capacity-slot flow unchanged. Bay-scheduled appointments set bay_id
-- and are validated by interval-overlap in the service layer (no DB constraint,
-- so legacy/parallel data is never rejected).
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "bay_id" uuid REFERENCES "workshop_bays"("id");

-- Helps the per-bay availability query (bay_id + date), mirroring the existing
-- idx_appointments_date_time composite pattern.
CREATE INDEX IF NOT EXISTS "idx_appointments_bay_date"
  ON "appointments" ("bay_id", "appointment_date");
