-- Replace full VIN unique index with a partial unique index so that archived
-- (historical) vehicle rows don't block re-entries creating a new vehicle row.
DROP INDEX IF EXISTS "uq_vehicles_vin";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicles_vin_active"
  ON "vehicles" ("vin")
  WHERE "status" <> 'Archived';