CREATE TABLE IF NOT EXISTS "customer_ar" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "db_ar_seq_id" varchar(40),
  "ar_account_number" varchar(40),
  "ar_account_type" varchar(10),
  "ar_type_descrip" varchar(100),
  "inactive_account" boolean DEFAULT false,
  "stop_credit" boolean DEFAULT false,
  "credit_limit_amount" numeric(14, 2),
  "credit_available_amount" numeric(14, 2),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "idx_customer_ar_customer_id"
  ON "customer_ar" ("customer_id");
