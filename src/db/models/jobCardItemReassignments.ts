import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { jobCardItems } from './jobCardItems';
import { users } from './users';

// Reassignment audit — one row per tech-A → tech-B handover on a single
// job-card item. The receiving technician's UI surfaces the latest row as
// an "inheritance banner" so they know the prior context.
export const jobCardItemReassignments = pgTable(
  'job_card_item_reassignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobCardItemId: uuid('job_card_item_id').notNull().references(() => jobCardItems.id, { onDelete: 'cascade' }),
    fromTechId: uuid('from_tech_id').references(() => users.id, { onDelete: 'set null' }),
    toTechId: uuid('to_tech_id').references(() => users.id, { onDelete: 'set null' }),
    reassignedBy: uuid('reassigned_by').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    priorSeconds: integer('prior_seconds').notNull().default(0),
    reassignedAt: timestamp('reassigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemIdx: index('idx_jci_reassign_item').on(t.jobCardItemId),
    atIdx: index('idx_jci_reassign_at').on(t.reassignedAt),
  }),
);

export const jobCardItemReassignmentsRelations = relations(jobCardItemReassignments, ({ one }) => ({
  item: one(jobCardItems, { fields: [jobCardItemReassignments.jobCardItemId], references: [jobCardItems.id] }),
  fromTech: one(users, { fields: [jobCardItemReassignments.fromTechId], references: [users.id] }),
  toTech: one(users, { fields: [jobCardItemReassignments.toTechId], references: [users.id] }),
  reassigner: one(users, { fields: [jobCardItemReassignments.reassignedBy], references: [users.id] }),
}));

export type JobCardItemReassignment = typeof jobCardItemReassignments.$inferSelect;
export type NewJobCardItemReassignment = typeof jobCardItemReassignments.$inferInsert;
