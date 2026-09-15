import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleCheckIns } from './vehicleCheckIns';
import { users } from './users';
import { qcOutOverallEnum } from './enums';

// One inspection per visit's QC Out attempt. A failed visit creates a NEW
// inspection row when the foreman reruns QC after rework — full audit of
// attempts, not just the last decision.
export const qcOutInspections = pgTable(
  'qc_out_inspections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    checkInId: uuid('check_in_id').notNull().references(() => vehicleCheckIns.id, { onDelete: 'cascade' }),
    overallStatus: qcOutOverallEnum('overall_status').notNull(),
    finalRemarks: text('final_remarks'),
    inspectorId: uuid('inspector_id').references(() => users.id, { onDelete: 'set null' }),
    signatureImageUrl: text('signature_image_url'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    checkInIdx: index('idx_qc_out_check_in').on(t.checkInId),
    completedAtIdx: index('idx_qc_out_completed_at').on(t.completedAt),
  }),
);

export const qcOutInspectionsRelations = relations(qcOutInspections, ({ one }) => ({
  checkIn: one(vehicleCheckIns, { fields: [qcOutInspections.checkInId], references: [vehicleCheckIns.id] }),
  inspector: one(users, { fields: [qcOutInspections.inspectorId], references: [users.id] }),
}));

export type QcOutInspection = typeof qcOutInspections.$inferSelect;
export type NewQcOutInspection = typeof qcOutInspections.$inferInsert;
