-- Add Microsoft 365 OAuth2 (client-credentials) support to email_settings,
-- alongside the existing Basic Authentication. Additive only — no columns
-- removed, no existing data changed. `auth_type` defaults to 'BASIC', so every
-- existing row (and the SMTP_* env fallback) keeps behaving exactly as today.
--
-- BASIC uses username + password_encrypted (unchanged).
-- MICROSOFT_OAUTH2 uses tenant_id + client_id + client_secret_encrypted +
-- sender_email; the app fetches an app-only access token from Azure AD
-- (scope https://outlook.office365.com/.default) and authenticates SMTP via
-- SASL XOAUTH2. Access tokens are NEVER stored. client_secret is encrypted
-- (AES-256-GCM, same as the SMTP password).

ALTER TABLE "email_settings"
  ADD COLUMN IF NOT EXISTS "auth_type"               varchar(20) NOT NULL DEFAULT 'BASIC',
  ADD COLUMN IF NOT EXISTS "tenant_id"               varchar(255),
  ADD COLUMN IF NOT EXISTS "client_id"               varchar(255),
  ADD COLUMN IF NOT EXISTS "client_secret_encrypted" text,
  ADD COLUMN IF NOT EXISTS "sender_email"            varchar(255);
