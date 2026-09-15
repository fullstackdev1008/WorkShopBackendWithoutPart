import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { qcInspections } from './qcInspections';
import { qcInspectionPhotos } from './qcInspectionPhotos';
import { qcCategoryEnum, qcItemResultEnum } from './enums';

export const qcInspectionItems = pgTable(
  'qc_inspection_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => qcInspections.id, { onDelete: 'cascade' }),

    category: qcCategoryEnum('category').notNull(),
    subCategory: varchar('sub_category', { length: 100 }),
    itemCode: varchar('item_code', { length: 50 }).notNull(),
    itemLabel: varchar('item_label', { length: 200 }).notNull(),
    sortOrder: integer('sort_order').notNull(),

    result: qcItemResultEnum('result'),
    comment: text('comment'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inspectionIdIdx: index('idx_qc_inspection_items_inspection_id').on(t.inspectionId),
    uniqueItemPerInspection: uniqueIndex('uq_qc_inspection_item').on(
      t.inspectionId,
      t.itemCode,
    ),
  }),
);

export const qcInspectionItemsRelations = relations(qcInspectionItems, ({ one, many }) => ({
  inspection: one(qcInspections, {
    fields: [qcInspectionItems.inspectionId],
    references: [qcInspections.id],
  }),
  photos: many(qcInspectionPhotos),
}));

export type QcInspectionItem = typeof qcInspectionItems.$inferSelect;
export type NewQcInspectionItem = typeof qcInspectionItems.$inferInsert;
