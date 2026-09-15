-- Partial unique index on registration_number for non-archived vehicles.
-- Mirrors uq_vehicles_vin_active so the uniqueness rule cannot be bypassed
-- from any code path (addVehicle, appointment booking, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicles_registration_active"
  ON "vehicles" ("registration_number")
  WHERE "status" <> 'Archived';
