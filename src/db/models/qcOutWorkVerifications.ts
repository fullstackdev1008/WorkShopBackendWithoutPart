import { pgTable, uuid, text, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { qcOutInspections } from './qcOutInspections';
import { vehicleCheckIns } from './vehicleCheckIns';
import { jobCardItems } from './jobCardItems';
import { users } from './users';

// One row per completed job-card item per QC-Out attempt. The inspector
// marks PASS/FAIL/NA before signing. A FAIL drives the standard QC failure
// loop (RO → QC_FAILED, foreman re-allocates) and the failed item is the
// rework hint.
export const qcOutWorkVerifications = pgTable(
  'qc_out_work_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    qcOutInspectionId: uuid('qc_out_inspection_id').references(() => qcOutInspections.id, { onDelete: 'cascade' }),
    checkInId: uuid('check_in_id').notNull().references(() => vehicleCheckIns.id, { onDelete: 'cascade' }),
    jobCardItemId: uuid('job_card_item_id').notNull().references(() => jobCardItems.id, { onDelete: 'cascade' }),
    result: varchar('result', { length: 10 }),         // 'PASS' | 'FAIL' | 'NA' | null
    notes: text('notes'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inspectionIdx: index('idx_qc_out_work_verif_inspection').on(t.qcOutInspectionId),
    checkInIdx: index('idx_qc_out_work_verif_check_in').on(t.checkInId),
    itemIdx: index('idx_qc_out_work_verif_item').on(t.jobCardItemId),
  }),
);

export const qcOutWorkVerificationsRelations = relations(qcOutWorkVerifications, ({ one }) => ({
  inspection: one(qcOutInspections, { fields: [qcOutWorkVerifications.qcOutInspectionId], references: [qcOutInspections.id] }),
  checkIn: one(vehicleCheckIns, { fields: [qcOutWorkVerifications.checkInId], references: [vehicleCheckIns.id] }),
  item: one(jobCardItems, { fields: [qcOutWorkVerifications.jobCardItemId], references: [jobCardItems.id] }),
}));

export type QcOutWorkVerification = typeof qcOutWorkVerifications.$inferSelect;
export type NewQcOutWorkVerification = typeof qcOutWorkVerifications.$inferInsert;
