import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleMakes } from './vehicleMakes';

export const vehicleModels = pgTable(
  'vehicle_models',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    makeId: uuid('make_id')
      .notNull()
      .references(() => vehicleMakes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    makeIdIdx: index('idx_vehicle_models_make_id').on(t.makeId),
    uniqueModelPerMake: uniqueIndex('uq_vehicle_model_per_make').on(t.makeId, t.name),
  }),
);

export const vehicleModelsRelations = relations(vehicleModels, ({ one }) => ({
  make: one(vehicleMakes, {
    fields: [vehicleModels.makeId],
    references: [vehicleMakes.id],
  }),
}));

export type VehicleModel = typeof vehicleModels.$inferSelect;
export type NewVehicleModel = typeof vehicleModels.$inferInsert;
