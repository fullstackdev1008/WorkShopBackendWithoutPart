-- Phase 4 — Alerts & Notifications
-- Config-driven dispatch: notification_rules + notification_templates drive
-- what goes out on each trigger. notifications = in-app inbox per user.
-- notification_log = append-only audit of every attempted dispatch.

DO $$ BEGIN
  CREATE TYPE "notification_trigger" AS ENUM (
    'RO_STATUS', 'APPROVAL', 'LABOUR_80', 'LABOUR_100', 'QC_FAIL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "notification_channel" AS ENUM ('WHATSAPP', 'EMAIL', 'INAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "notification_audience" AS ENUM (
    'CUSTOMER', 'TECHNICIAN', 'FOREMAN', 'SA', 'PARTS', 'MANAGER', 'CONTROLLER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "notification_level" AS ENUM ('INFO', 'WARN', 'CRIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "notification_status" AS ENUM ('sent', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "notification_templates" (
  "key"        varchar(60) PRIMARY KEY,
  "channel"    "notification_channel" NOT NULL,
  "subject"    text,
  "body"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "notification_rules" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trigger_type"  "notification_trigger" NOT NULL,
  "trigger_value" text NOT NULL,
  "channel"       "notification_channel" NOT NULL,
  "audience"      "notification_audience" NOT NULL,
  "template_key"  varchar(60) NOT NULL REFERENCES "notification_templates"("key"),
  "enabled"       boolean NOT NULL DEFAULT true,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_rules_trigger"
  ON "notification_rules" ("trigger_type", "trigger_value")
  WHERE "enabled" = true;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "level"      "notification_level" NOT NULL DEFAULT 'INFO',
  "title"      text NOT NULL,
  "body"       text NOT NULL,
  "ref_type"   text,
  "ref_id"     uuid,
  "read_at"    timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
  ON "notifications" ("user_id")
  WHERE "read_at" IS NULL;

CREATE TABLE IF NOT EXISTS "notification_log" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id"      uuid REFERENCES "notification_rules"("id") ON DELETE SET NULL,
  "channel"      "notification_channel" NOT NULL,
  "audience"     "notification_audience" NOT NULL,
  "recipient"    text NOT NULL,
  "template_key" varchar(60),
  "ref_type"     text,
  "ref_id"       uuid,
  "status"       "notification_status" NOT NULL,
  "error"        text,
  "sent_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_notification_log_ref" ON "notification_log" ("ref_id");
CREATE INDEX IF NOT EXISTS "idx_notification_log_sent_at" ON "notification_log" ("sent_at");

-- Labour overrun bookkeeping — idempotency for the 80% / 100% cron.
ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "alerted_80pct_at"  timestamptz,
  ADD COLUMN IF NOT EXISTS "alerted_100pct_at" timestamptz;

-- ─── Seed templates ────────────────────────────────────────────────────────
INSERT INTO "notification_templates" ("key", "channel", "subject", "body") VALUES
  ('wa_arrived',           'WHATSAPP', NULL,                    'Hi {{customer_name}}, your vehicle {{reg}} has arrived at our workshop. Receiving #{{recv_no}}.'),
  ('wa_qc_started',        'WHATSAPP', NULL,                    'QC inspection has started for your vehicle {{reg}}.'),
  ('wa_in_workshop',       'WHATSAPP', NULL,                    'Your vehicle {{reg}} is now in Bay {{bay_no}}.'),
  ('wa_diagnosing',        'WHATSAPP', NULL,                    'Diagnosis is in progress for {{reg}}.'),
  ('wa_awaiting_approval', 'WHATSAPP', NULL,                    'Estimate sent for {{reg}}. Please review and approve.'),
  ('wa_approved',          'WHATSAPP', NULL,                    'Thanks for approving the estimate for {{reg}}. Repairs will begin shortly.'),
  ('wa_waiting_parts',     'WHATSAPP', NULL,                    'Awaiting parts for {{reg}}. We will update you when work resumes.'),
  ('wa_repairs_started',   'WHATSAPP', NULL,                    'Repairs have begun on your vehicle {{reg}}.'),
  ('wa_qc_passed',         'WHATSAPP', NULL,                    'Your vehicle {{reg}} has passed final QC and is moving to the washbay.'),
  ('wa_washbay',           'WHATSAPP', NULL,                    'Your vehicle {{reg}} is in the washbay.'),
  ('wa_ready',             'WHATSAPP', NULL,                    'Your vehicle {{reg}} is ready for collection.'),
  ('wa_released',          'WHATSAPP', NULL,                    'Your vehicle {{reg}} has been collected. Thank you!'),
  -- Staff
  ('inapp_approved_staff', 'INAPP',    'Customer approved estimate', 'Customer approved the estimate for {{reg}} ({{recv_no}}). Please proceed.'),
  ('email_approved_staff', 'EMAIL',    'Customer approved estimate ({{reg}})', 'The customer has approved the estimate for {{reg}}. Receiving #{{recv_no}}. Please proceed.'),
  ('inapp_qc_failed',      'INAPP',    'QC FAIL — {{reg}}',     'QC inspection failed for {{reg}}. Please review and reassign.'),
  ('inapp_labour_80',      'INAPP',    'Labour 80% — {{reg}}',  'Item "{{job_desc}}" on {{reg}} has reached 80% of its estimated time.'),
  ('inapp_labour_100',     'INAPP',    'Labour over budget — {{reg}}', 'Item "{{job_desc}}" on {{reg}} has exceeded its estimated time.')
ON CONFLICT ("key") DO NOTHING;

-- ─── Seed rules ────────────────────────────────────────────────────────────
INSERT INTO "notification_rules" ("trigger_type", "trigger_value", "channel", "audience", "template_key") VALUES
  ('RO_STATUS', 'ARRIVED',            'WHATSAPP', 'CUSTOMER',  'wa_arrived'),
  ('RO_STATUS', 'QC_CHECK_IN',        'WHATSAPP', 'CUSTOMER',  'wa_qc_started'),
  ('RO_STATUS', 'IN_WORKSHOP',        'WHATSAPP', 'CUSTOMER',  'wa_in_workshop'),
  ('RO_STATUS', 'DIAGNOSING',         'WHATSAPP', 'CUSTOMER',  'wa_diagnosing'),
  ('RO_STATUS', 'AWAITING_APPROVAL',  'WHATSAPP', 'CUSTOMER',  'wa_awaiting_approval'),
  ('RO_STATUS', 'APPROVED',           'WHATSAPP', 'CUSTOMER',  'wa_approved'),
  ('RO_STATUS', 'WAITING_FOR_PARTS',  'WHATSAPP', 'CUSTOMER',  'wa_waiting_parts'),
  ('RO_STATUS', 'REPAIRS_STARTED',    'WHATSAPP', 'CUSTOMER',  'wa_repairs_started'),
  ('RO_STATUS', 'QC_PASSED',          'WHATSAPP', 'CUSTOMER',  'wa_qc_passed'),
  ('RO_STATUS', 'WASHBAY',            'WHATSAPP', 'CUSTOMER',  'wa_washbay'),
  ('RO_STATUS', 'READY_FOR_RELEASE',  'WHATSAPP', 'CUSTOMER',  'wa_ready'),
  ('RO_STATUS', 'RELEASED',           'WHATSAPP', 'CUSTOMER',  'wa_released'),
  -- Staff broadcasts on customer approval
  ('APPROVAL',  'APPROVED',           'INAPP',    'SA',         'inapp_approved_staff'),
  ('APPROVAL',  'APPROVED',           'INAPP',    'PARTS',      'inapp_approved_staff'),
  ('APPROVAL',  'APPROVED',           'INAPP',    'FOREMAN',    'inapp_approved_staff'),
  ('APPROVAL',  'APPROVED',           'INAPP',    'CONTROLLER', 'inapp_approved_staff'),
  ('APPROVAL',  'APPROVED',           'EMAIL',    'SA',         'email_approved_staff'),
  -- QC fail broadcast
  ('QC_FAIL',   'QC_FAILED',          'INAPP',    'FOREMAN',    'inapp_qc_failed'),
  ('QC_FAIL',   'QC_FAILED',          'INAPP',    'MANAGER',    'inapp_qc_failed'),
  ('QC_FAIL',   'QC_FAILED',          'INAPP',    'CONTROLLER', 'inapp_qc_failed'),
  -- Labour alerts
  ('LABOUR_80', 'LABOUR_80',          'INAPP',    'TECHNICIAN', 'inapp_labour_80'),
  ('LABOUR_80', 'LABOUR_80',          'INAPP',    'FOREMAN',    'inapp_labour_80'),
  ('LABOUR_80', 'LABOUR_80',          'INAPP',    'CONTROLLER', 'inapp_labour_80'),
  ('LABOUR_80', 'LABOUR_80',          'INAPP',    'MANAGER',    'inapp_labour_80'),
  ('LABOUR_100','LABOUR_100',         'INAPP',    'TECHNICIAN', 'inapp_labour_100'),
  ('LABOUR_100','LABOUR_100',         'INAPP',    'FOREMAN',    'inapp_labour_100'),
  ('LABOUR_100','LABOUR_100',         'INAPP',    'CONTROLLER', 'inapp_labour_100'),
  ('LABOUR_100','LABOUR_100',         'INAPP',    'MANAGER',    'inapp_labour_100')
ON CONFLICT DO NOTHING;
