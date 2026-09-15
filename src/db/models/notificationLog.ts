import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import {
  notificationChannelEnum,
  notificationAudienceEnum,
  notificationStatusEnum,
} from './enums';

// Append-only audit of every dispatch attempt. Lets us answer "did the
// customer get the WhatsApp?" with one SQL query.
export const notificationLog = pgTable(
  'notification_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ruleId: uuid('rule_id'),
    channel: notificationChannelEnum('channel').notNull(),
    audience: notificationAudienceEnum('audience').notNull(),
    recipient: text('recipient').notNull(),
    templateKey: varchar('template_key', { length: 60 }),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    status: notificationStatusEnum('status').notNull(),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    refIdx: index('idx_notification_log_ref').on(t.refId),
    sentAtIdx: index('idx_notification_log_sent_at').on(t.sentAt),
  }),
);

export type NotificationLog = typeof notificationLog.$inferSelect;
export type NewNotificationLog = typeof notificationLog.$inferInsert;
