import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { notificationTemplates } from './notificationTemplates';
import {
  notificationTriggerEnum,
  notificationChannelEnum,
  notificationAudienceEnum,
} from './enums';

// One row per (trigger, channel, audience). The dispatcher reads enabled
// rules whose trigger matches the event, resolves the template, and sends.
export const notificationRules = pgTable('notification_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  triggerType: notificationTriggerEnum('trigger_type').notNull(),
  triggerValue: text('trigger_value').notNull(),
  channel: notificationChannelEnum('channel').notNull(),
  audience: notificationAudienceEnum('audience').notNull(),
  templateKey: varchar('template_key', { length: 60 })
    .notNull()
    .references(() => notificationTemplates.key),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationRulesRelations = relations(notificationRules, ({ one }) => ({
  template: one(notificationTemplates, {
    fields: [notificationRules.templateKey],
    references: [notificationTemplates.key],
  }),
}));

export type NotificationRule = typeof notificationRules.$inferSelect;
export type NewNotificationRule = typeof notificationRules.$inferInsert;
