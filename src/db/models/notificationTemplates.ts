import { pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { notificationChannelEnum } from './enums';

// Templates are keyed by a short, human-readable key (e.g. `wa_arrived`).
// Body supports `{{var}}` placeholders resolved at dispatch time. Subject
// is only used for EMAIL channel.
export const notificationTemplates = pgTable('notification_templates', {
  key: varchar('key', { length: 60 }).primaryKey(),
  channel: notificationChannelEnum('channel').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;
