import { pgTable, uuid, varchar, text, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { qcOutInspections } from './qcOutInspections';
import { qcInspectionItems } from './qcInspectionItems';
import { qcOutItemStatusEnum } from './enums';

// Snapshot of each checklist item at inspection time. Mirrors qc_inspection_items
// (Phase 9 — 3.10) so QC In and QC Out items can be compared row-by-row to
// flag any item that was PASS at entry but FAIL at exit as workshop damage.
export const qcOutInspectionItems = pgTable(
  'qc_out_inspection_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inspectionId: uuid('inspection_id').notNull().references(() => qcOutInspections.id, { onDelete: 'cascade' }),
    // Structured fields mirrored from QC In so comparison joins are direct.
    // varchar, not the qc_category enum: QC In widened to dynamic categories in
    // 0060 (truck sheet uses Engine, Cooling System, …) and this column copies
    // whatever QC In holds, so it has to accept the same values (see 0067).
    category: varchar('category', { length: 100 }),
    subCategory: varchar('sub_category', { length: 100 }),
    itemCode: varchar('item_code', { length: 50 }),
    itemLabel: text('item_label').notNull(),
    // Pointer to the corresponding QC In item (same checkInId, same itemCode).
    // Null if the master added an item between QC In and QC Out.
    qcInItemId: uuid('qc_in_item_id').references(() => qcInspectionItems.id, { onDelete: 'set null' }),
    status: qcOutItemStatusEnum('status').notNull(),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    inspectionIdx: index('idx_qc_out_items_inspection').on(t.inspectionId),
    qcInItemIdx: index('idx_qc_out_items_qc_in_item').on(t.qcInItemId),
  }),
);

export const qcOutInspectionItemsRelations = relations(qcOutInspectionItems, ({ one }) => ({
  inspection: one(qcOutInspections, { fields: [qcOutInspectionItems.inspectionId], references: [qcOutInspections.id] }),
}));

export type QcOutInspectionItem = typeof qcOutInspectionItems.$inferSelect;
export type NewQcOutInspectionItem = typeof qcOutInspectionItems.$inferInsert;
