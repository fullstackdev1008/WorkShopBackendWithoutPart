import { pgTable, uuid, varchar, integer, boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Admin-configurable SMTP settings (single-row). Replaces manual .env editing.
 * `passwordEncrypted` holds the SMTP password encrypted at rest (AES-256-GCM);
 * it is never returned to the client. When the row is absent or `enabled` is
 * false, the email service falls back to the SMTP_* env vars.
 */
export const emailSettings = pgTable('email_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  // 'BASIC' (username/password) or 'MICROSOFT_OAUTH2' (Azure AD client-credentials).
  authType: varchar('auth_type', { length: 20 }).notNull().default('BASIC'),
  host: varchar('host', { length: 255 }),
  port: integer('port').notNull().default(587),
  secure: boolean('secure').notNull().default(false),
  // Basic auth
  username: varchar('username', { length: 255 }),
  passwordEncrypted: text('password_encrypted'),
  // Microsoft 365 OAuth2 (client-credentials). clientSecret encrypted at rest;
  // access tokens are never stored.
  tenantId: varchar('tenant_id', { length: 255 }),
  clientId: varchar('client_id', { length: 255 }),
  clientSecretEncrypted: text('client_secret_encrypted'),
  senderEmail: varchar('sender_email', { length: 255 }),
  fromName: varchar('from_name', { length: 120 }),
  fromEmail: varchar('from_email', { length: 255 }),
  replyTo: varchar('reply_to', { length: 255 }),
  enabled: boolean('enabled').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EmailSettings = typeof emailSettings.$inferSelect;
export type NewEmailSettings = typeof emailSettings.$inferInsert;
