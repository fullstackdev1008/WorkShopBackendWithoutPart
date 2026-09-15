import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const vehicleColours = pgTable(
  'vehicle_colours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    type: varchar('type', { length: 3 }).notNull(), // 'EXT' or 'INT'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCodeType: uniqueIndex('uq_vehicle_colours_code_type').on(t.code, t.type),
  }),
);

export type VehicleColour = typeof vehicleColours.$inferSelect;
export type NewVehicleColour = typeof vehicleColours.$inferInsert;
