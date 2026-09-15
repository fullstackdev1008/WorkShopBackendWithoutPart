-- Labour Master (Phase 3). Admin-managed list feeding the Job Card Labour
-- section dropdown. Mirrors the designations master (name + is_active, CI-unique,
-- soft deactivate). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "labour_descriptions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"          varchar(100) NOT NULL,
  "display_order" integer NOT NULL DEFAULT 0,
  "is_active"     boolean NOT NULL DEFAULT true,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_labour_descriptions_name_ci"
  ON "labour_descriptions" (lower("name"));

-- Seed the default labour descriptions (idempotent on the CI-unique name).
-- Note: display_order is intentionally omitted — 0059 drops that column, so the
-- seed must not reference it (keeps this migration safe to re-run afterwards).
INSERT INTO "labour_descriptions" ("name", "is_active") VALUES
  ('Inspection',     true),
  ('Minor Service',  true),
  ('Major Service',  true),
  ('Brake Service',  true),
  ('Oil Change',     true)
ON CONFLICT (lower("name")) DO NOTHING;
