-- Phase 7 — Invoicing & Release
-- After QC-out + washbay the vehicle reaches READY_FOR_RELEASE. Finance
-- builds an invoice from the approved job-card items (warranty items
-- billed at 0 to the customer), customer pays in part or in full, and on
-- full payment a gate pass is generated. Security scans the pass at exit,
-- captures odometer + driver-out signature, and the RO closes.
--
-- Invoice lifecycle:   DRAFT → GENERATED → PARTIALLY_PAID → PAID
--                                       ↘ VOID (admin only, when GENERATED)
-- Gate-pass lifecycle: ACTIVE → REDEEMED  (or VOIDED if invoice voided)

DO $$ BEGIN
  CREATE TYPE "invoice_status" AS ENUM (
    'DRAFT', 'GENERATED', 'PARTIALLY_PAID', 'PAID', 'VOID'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "payment_mode" AS ENUM (
    'CASH', 'CARD', 'UPI', 'BANK', 'CHEQUE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "invoice_line_source" AS ENUM (
    'JOB_CARD_ITEM', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "gate_pass_status" AS ENUM (
    'ACTIVE', 'REDEEMED', 'VOIDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Invoice + gate-pass sequences (INV-YYYY-NNNNN, GP-NNNNN built in code).
CREATE SEQUENCE IF NOT EXISTS "inv_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "gp_seq"  START 1;

CREATE TABLE IF NOT EXISTS "invoices" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_no"       varchar(30) NOT NULL UNIQUE,
  "job_card_id"      uuid NOT NULL REFERENCES "job_cards"("id") ON DELETE RESTRICT,
  "check_in_id"      uuid REFERENCES "vehicle_check_ins"("id") ON DELETE SET NULL,
  "vehicle_id"       uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "customer_id"      uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "status"           "invoice_status" NOT NULL DEFAULT 'DRAFT',
  "subtotal"         numeric(12,2) NOT NULL DEFAULT 0,
  "tax_label"        varchar(20)   NOT NULL DEFAULT 'GST',
  "tax_percentage"   numeric(5,2)  NOT NULL DEFAULT 0,
  "tax_amount"       numeric(12,2) NOT NULL DEFAULT 0,
  "discount_amount"  numeric(12,2) NOT NULL DEFAULT 0,
  "total_amount"     numeric(12,2) NOT NULL DEFAULT 0,
  "paid_amount"      numeric(12,2) NOT NULL DEFAULT 0,
  "currency_code"    varchar(3)    NOT NULL DEFAULT 'USD',
  "notes"            text,
  "generated_at"     timestamptz,
  "generated_by"     uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "voided_at"        timestamptz,
  "voided_by"        uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "void_reason"      text,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_invoices_job_card"   ON "invoices" ("job_card_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_check_in"   ON "invoices" ("check_in_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_status"     ON "invoices" ("status");
CREATE INDEX IF NOT EXISTS "idx_invoices_customer"   ON "invoices" ("customer_id");

-- A job card should have at most one non-void invoice at a time. Enforced
-- with a partial unique index so re-issue after VOID is possible.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_invoice_active_per_jc"
  ON "invoices" ("job_card_id")
  WHERE "status" <> 'VOID';

CREATE TABLE IF NOT EXISTS "invoice_lines" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id"     uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "source"         "invoice_line_source" NOT NULL,
  "ref_id"         uuid,
  "description"    text NOT NULL,
  "quantity"       numeric(10,2) NOT NULL DEFAULT 1,
  "unit_price"     numeric(12,2) NOT NULL DEFAULT 0,
  "line_total"     numeric(12,2) NOT NULL DEFAULT 0,
  "is_warranty"    boolean NOT NULL DEFAULT false,
  "sort_order"     integer NOT NULL DEFAULT 0,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_invoice_lines_invoice" ON "invoice_lines" ("invoice_id");

CREATE TABLE IF NOT EXISTS "invoice_payments" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id"     uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "amount"         numeric(12,2) NOT NULL,
  "mode"           "payment_mode" NOT NULL,
  "reference_no"   varchar(120),
  "paid_at"        timestamptz NOT NULL DEFAULT now(),
  "captured_by"    uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "notes"          text,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_invoice_payments_invoice" ON "invoice_payments" ("invoice_id");

CREATE TABLE IF NOT EXISTS "gate_passes" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"                     varchar(20) NOT NULL UNIQUE,
  "invoice_id"               uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "check_in_id"              uuid REFERENCES "vehicle_check_ins"("id") ON DELETE SET NULL,
  "vehicle_id"               uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "status"                   "gate_pass_status" NOT NULL DEFAULT 'ACTIVE',
  "generated_at"             timestamptz NOT NULL DEFAULT now(),
  "generated_by"             uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "redeemed_at"              timestamptz,
  "redeemed_by"              uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "odometer_out"             integer,
  "driver_out_name"          varchar(150),
  "driver_out_signature_url" text,
  "notes"                    text,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_gate_passes_invoice"  ON "gate_passes" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_gate_passes_check_in" ON "gate_passes" ("check_in_id");
CREATE INDEX IF NOT EXISTS "idx_gate_passes_status"   ON "gate_passes" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_gate_pass_active_per_invoice"
  ON "gate_passes" ("invoice_id")
  WHERE "status" = 'ACTIVE';
