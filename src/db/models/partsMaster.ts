import {
  pgTable,
  uuid,
  varchar,
  boolean,
  numeric,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const partsMaster = pgTable(
  'parts_master',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partCode: varchar('part_code', { length: 50 }).notNull(),
    partName: varchar('part_name', { length: 200 }).notNull(),
    defaultPrice: numeric('default_price', { precision: 12, scale: 2 }).default('0'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePartCode: uniqueIndex('uq_parts_master_code').on(t.partCode),
  }),
);

export type PartMaster = typeof partsMaster.$inferSelect;
export type NewPartMaster = typeof partsMaster.$inferInsert;
