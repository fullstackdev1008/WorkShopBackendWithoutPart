-- Model Service Type Assignment → Model Code ("Series") support.
--
-- Adds the third cascade level (Make → Model → Model Code) to assignments so
-- job-card auto-load can match parts by the stable Evolve MM code carried on
-- vehicles.model_code (e.g. "18665355"), instead of the fragile free-text model
-- name match (vehicle_models.name = vehicles.model) that silently returned zero
-- parts whenever the strings differed.
--
-- Additive + idempotent + nullable: existing rows stay NULL; a NULL model_code
-- assignment falls back to the legacy model-name match in getAssignmentsByCategory.
ALTER TABLE "model_service_type_assignments"
  ADD COLUMN IF NOT EXISTS "model_code" varchar(50);

CREATE INDEX IF NOT EXISTS "idx_msta_model_code"
  ON "model_service_type_assignments" ("model_code");
