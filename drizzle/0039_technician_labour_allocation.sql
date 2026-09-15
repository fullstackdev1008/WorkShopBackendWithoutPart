-- Technician labour allocation: TrueGear → Evolve (IRM_ROMaintenance / ROJobDetails).
-- Additive + idempotent. All columns are NULLABLE and unused while
-- EVOLVE_LABOUR_LINES_ENABLED is false (the default) — existing rows stay NULL
-- and no existing query, API response, or behaviour depends on them.
--
--   users.evolve_technician_no        Evolve TechnicianNo (from IRM_GetLookupDropdownTables);
--                                      resolved at RO-sync time to populate <TechNo>. NULL for
--                                      non-technicians and unmapped technicians. No FK (Evolve
--                                      is external). Partial-unique below.
--   job_card_items.hours_worked        actual labour hours  → <HoursWorked> (decimal e.g. 0.25)
--   job_card_items.hours_sold          billed labour hours  → <HoursSold>
--   job_card_items.evolve_line_number  persisted ROJobDetails LineNumber (idempotent re-send)
--   job_card_items.evolve_line_status  ROJobDetails LineStatus lifecycle (N/U/P/D)

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "evolve_technician_no" integer;

-- One Evolve technician maps to at most one local user (prevents labour being
-- posted against the same TechnicianNo from two accounts). Partial so the many
-- unmapped / non-technician rows (NULL) remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_evolve_technician_no"
  ON "users" ("evolve_technician_no")
  WHERE "evolve_technician_no" IS NOT NULL;

ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "hours_worked" numeric(6, 2);
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "hours_sold" numeric(6, 2);
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "evolve_line_number" integer;
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "evolve_line_status" varchar(1);
