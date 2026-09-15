-- Third level of the Evolve vehicle hierarchy: Make → Series (vehicle_models)
-- → Model Code. Populated on demand from IRM_GetModelCodes for a given
-- (Make, Series) and cached here. Evolve returns one <Model> row per
-- model-year, and we store every one of them (full fidelity): code,
-- M&M code, description, and year. Unique per (model, code, year).

CREATE TABLE IF NOT EXISTS "vehicle_model_codes" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "model_id"    uuid NOT NULL REFERENCES "vehicle_models"("id") ON DELETE CASCADE,
  "code"        varchar(50) NOT NULL,
  "mandm_code"  varchar(50),
  "description" varchar(200),
  "model_year"  integer,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

-- If an earlier version of this table already exists (per-code only), bring it
-- up to the full shape.
ALTER TABLE "vehicle_model_codes" ADD COLUMN IF NOT EXISTS "mandm_code" varchar(50);
ALTER TABLE "vehicle_model_codes" ADD COLUMN IF NOT EXISTS "model_year" integer;

CREATE INDEX IF NOT EXISTS "idx_vehicle_model_codes_model_id" ON "vehicle_model_codes" ("model_id");

-- Replace the per-code unique index with per-(code, year) so every model-year
-- row from Evolve is kept rather than collapsed to one per code.
DROP INDEX IF EXISTS "uq_vehicle_model_code_per_model";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_model_code_per_model_year"
  ON "vehicle_model_codes" ("model_id", "code", "model_year");
