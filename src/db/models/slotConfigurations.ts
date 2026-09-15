import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const slotConfigurations = pgTable(
  'slot_configurations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    time: varchar('time', { length: 5 }).notNull(),       // "09:00"
    capacity: integer('capacity').default(3).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueTime: uniqueIndex('uq_slot_configurations_time').on(t.time),
  }),
);
