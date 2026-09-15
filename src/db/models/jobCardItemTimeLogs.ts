import {
  pgTable,
  uuid,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { jobCardItems } from './jobCardItems';
import { users } from './users';

export const jobCardItemTimeLogs = pgTable(
  'job_card_item_time_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobCardItemId: uuid('job_card_item_id')
      .notNull()
      .references(() => jobCardItems.id, { onDelete: 'cascade' }),
    technicianId: uuid('technician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemIdx: index('idx_jci_time_logs_item_id').on(t.jobCardItemId),
    technicianIdx: index('idx_jci_time_logs_technician_id').on(t.technicianId),
  }),
);

export const jobCardItemTimeLogsRelations = relations(jobCardItemTimeLogs, ({ one }) => ({
  item: one(jobCardItems, {
    fields: [jobCardItemTimeLogs.jobCardItemId],
    references: [jobCardItems.id],
  }),
  technician: one(users, {
    fields: [jobCardItemTimeLogs.technicianId],
    references: [users.id],
  }),
}));

export type JobCardItemTimeLog = typeof jobCardItemTimeLogs.$inferSelect;
export type NewJobCardItemTimeLog = typeof jobCardItemTimeLogs.$inferInsert;
