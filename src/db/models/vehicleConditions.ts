import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const vehicleConditions = pgTable(
  'vehicle_conditions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCode: uniqueIndex('uq_vehicle_conditions_code').on(t.code),
  }),
);

export type VehicleCondition = typeof vehicleConditions.$inferSelect;
export type NewVehicleCondition = typeof vehicleConditions.$inferInsert;
