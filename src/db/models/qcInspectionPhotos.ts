import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { qcInspectionItems } from './qcInspectionItems';

export const qcInspectionPhotos = pgTable(
  'qc_inspection_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    inspectionItemId: uuid('inspection_item_id')
      .notNull()
      .references(() => qcInspectionItems.id, { onDelete: 'cascade' }),

    imageUrl: varchar('image_url', { length: 500 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inspectionItemIdIdx: index('idx_qc_inspection_photos_item_id').on(t.inspectionItemId),
  }),
);

export const qcInspectionPhotosRelations = relations(qcInspectionPhotos, ({ one }) => ({
  inspectionItem: one(qcInspectionItems, {
    fields: [qcInspectionPhotos.inspectionItemId],
    references: [qcInspectionItems.id],
  }),
}));

export type QcInspectionPhoto = typeof qcInspectionPhotos.$inferSelect;
export type NewQcInspectionPhoto = typeof qcInspectionPhotos.$inferInsert;
