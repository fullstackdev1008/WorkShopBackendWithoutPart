import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { qcOutInspections } from './qcOutInspections';
import { qcOutInspectionItems } from './qcOutInspectionItems';
import { users } from './users';

// Photo evidence per QC-Out attempt. item_id is nullable so the inspector
// can attach overall-inspection photos too (e.g. odometer shot, dashboard).
export const qcOutInspectionPhotos = pgTable(
  'qc_out_inspection_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inspectionId: uuid('inspection_id').notNull().references(() => qcOutInspections.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => qcOutInspectionItems.id, { onDelete: 'cascade' }),
    imageUrl: text('image_url').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    takenBy: uuid('taken_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    inspectionIdx: index('idx_qc_out_photos_inspection').on(t.inspectionId),
  }),
);

export const qcOutInspectionPhotosRelations = relations(qcOutInspectionPhotos, ({ one }) => ({
  inspection: one(qcOutInspections, { fields: [qcOutInspectionPhotos.inspectionId], references: [qcOutInspections.id] }),
}));

export type QcOutInspectionPhoto = typeof qcOutInspectionPhotos.$inferSelect;
export type NewQcOutInspectionPhoto = typeof qcOutInspectionPhotos.$inferInsert;
