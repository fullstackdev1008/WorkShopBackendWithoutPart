-- Admin-configurable SMTP (email) settings — replaces manual .env editing.
-- Single-row configuration (the service always reads/writes the first row and
-- creates it on first save). The SMTP password is stored ENCRYPTED
-- (AES-256-GCM, see shared/security/crypto) and never returned in plain text.
-- `enabled` gates whether the app uses these settings; when the table is empty
-- or disabled the email service falls back to the SMTP_* env vars (backward
-- compatible). Additive + idempotent.

CREATE TABLE IF NOT EXISTS "email_settings" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "host"               varchar(255),
  "port"               integer NOT NULL DEFAULT 587,
  "secure"             boolean NOT NULL DEFAULT false,
  "username"           varchar(255),
  "password_encrypted" text,
  "from_name"          varchar(120),
  "from_email"         varchar(255),
  "reply_to"           varchar(255),
  "enabled"            boolean NOT NULL DEFAULT false,
  "updated_by"         uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);
