import { pgTable, uuid, boolean, varchar, numeric, text, timestamp, index } from 'drizzle-orm/pg-core';
import { jobCards } from './jobCards';
import { users } from './users';

/**
 * Append-only audit of Service-Advisor edits to a job card after creation.
 * Modelled on roStatusHistory: one row per edit, written inside the same
 * transaction as the edit so the trail never drifts. Records who/when/what and
 * the business consequences (estimate impact, parts reconfirmation, approval
 * invalidation, any controlled lifecycle regression).
 */
export const jobCardEditHistory = pgTable(
  'job_card_edit_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobCardId: uuid('job_card_id')
      .notNull()
      .references(() => jobCards.id, { onDelete: 'cascade' }),
    editedBy: uuid('edited_by').references(() => users.id, { onDelete: 'set null' }),
    estimateAffected: boolean('estimate_affected').notNull().default(false),
    reconfirmationTriggered: boolean('reconfirmation_triggered').notNull().default(false),
    approvalInvalidated: boolean('approval_invalidated').notNull().default(false),
    fromStatus: varchar('from_status', { length: 40 }),
    toStatus: varchar('to_status', { length: 40 }),
    prevTotal: numeric('prev_total', { precision: 12, scale: 2 }),
    newTotal: numeric('new_total', { precision: 12, scale: 2 }),
    summary: text('summary'),
    editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byJobCard: index('idx_job_card_edit_history_job_card').on(t.jobCardId),
  }),
);

export type JobCardEditHistory = typeof jobCardEditHistory.$inferSelect;
export type NewJobCardEditHistory = typeof jobCardEditHistory.$inferInsert;
