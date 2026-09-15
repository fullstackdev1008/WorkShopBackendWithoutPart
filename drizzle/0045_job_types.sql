-- AI-1 — Job Type lookup cache (RO <JobType>).
--
-- Local, read-mostly cache mirroring the service_types pattern. Populated later
-- from an Evolve lookup (blocked on client: lookup source, XML tags, code map).
-- Intentionally NOT seeded — no guessed Job Type codes. Until the Evolve lookup
-- sync exists, this table stays empty and the UI shows "No Job Types configured."
--
-- Additive + idempotent: new table only, no changes to existing rows.

CREATE TABLE IF NOT EXISTS "job_types" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"       varchar(50)  NOT NULL,
  "name"       varchar(100) NOT NULL,
  "is_active"  boolean      NOT NULL DEFAULT true,
  "created_at" timestamptz  NOT NULL DEFAULT now(),
  "updated_at" timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_types_code" ON "job_types" ("code");
