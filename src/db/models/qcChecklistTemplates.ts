import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const qcChecklistTemplates = pgTable(
  'qc_checklist_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    category: varchar('category', { length: 50 }).notNull(),   // EXTERIOR, INTERIOR, BRAKE
    subCategory: varchar('sub_category', { length: 100 }),      // Engine, Cooling System, etc.
    itemCode: varchar('item_code', { length: 50 }).notNull(),
    itemLabel: varchar('item_label', { length: 200 }).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCode: uniqueIndex('uq_qc_checklist_templates_code').on(t.itemCode),
  }),
);
