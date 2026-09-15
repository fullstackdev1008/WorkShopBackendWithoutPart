import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleModels } from './vehicleModels';

export const vehicleMakes = pgTable(
  'vehicle_makes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueName: uniqueIndex('uq_vehicle_makes_name').on(t.name),
  }),
);

export const vehicleMakesRelations = relations(vehicleMakes, ({ many }) => ({
  models: many(vehicleModels),
}));

export type VehicleMake = typeof vehicleMakes.$inferSelect;
export type NewVehicleMake = typeof vehicleMakes.$inferInsert;
