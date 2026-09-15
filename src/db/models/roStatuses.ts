import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const roStatuses = pgTable(
  'ro_statuses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCode: uniqueIndex('uq_ro_statuses_code').on(t.code),
  }),
);

export type RoStatus = typeof roStatuses.$inferSelect;
export type NewRoStatus = typeof roStatuses.$inferInsert;
