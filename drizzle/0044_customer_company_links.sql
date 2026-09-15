-- Phase B3 — customer_company_links.
--
-- A customer may exist in multiple companies (each with its own Evolve
-- CustSequenceID), so the customer↔company relationship is a join table.
-- Written idempotently at appointment creation (ON CONFLICT DO NOTHING).
--
-- FK semantics (ADR-001 Appendix B):
--   customer_id → customers(id) ON DELETE CASCADE  (link meaningless without its customer)
--   company_id  → companies(id) ON DELETE RESTRICT (companies are deactivated, not deleted)
--
-- Additive + idempotent: new table only, no changes to existing rows.

CREATE TABLE IF NOT EXISTS "customer_company_links" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id"      uuid NOT NULL REFERENCES "customers"("id")  ON DELETE CASCADE,
  "company_id"       uuid NOT NULL REFERENCES "companies"("id")  ON DELETE RESTRICT,
  "cust_sequence_id" varchar(50),
  "crm_reference_no" varchar(50),
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

-- One link per (customer, company); also the ON CONFLICT target for idempotent upserts.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_company_links_customer_company"
  ON "customer_company_links" ("customer_id", "company_id");

CREATE INDEX IF NOT EXISTS "idx_customer_company_links_company_id"
  ON "customer_company_links" ("company_id");
