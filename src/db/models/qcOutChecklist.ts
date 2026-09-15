import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

// Editable list of QC-Out checklist items used to seed each new inspection.
// Master-only — individual inspections snapshot the label into `qc_out_inspection_items`
// at the moment of creation, so editing the master never alters past records.
export const qcOutChecklist = pgTable('qc_out_checklist', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type QcOutChecklist = typeof qcOutChecklist.$inferSelect;
export type NewQcOutChecklist = typeof qcOutChecklist.$inferInsert;
