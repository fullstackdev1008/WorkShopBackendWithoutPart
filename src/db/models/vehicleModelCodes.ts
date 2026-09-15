import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleModels } from './vehicleModels';

/**
 * Third level of the Evolve vehicle hierarchy: Make → Series (vehicle_models)
 * → Model Code. Populated on demand from IRM_GetModelCodes for a given
 * (Make, Series) and cached here so the picker doesn't hit Evolve every time.
 * Evolve returns one <Model> row per model-year — we store all of them in full
 * (code, M&M code, description, year). Unique per (model, code, year).
 */
export const vehicleModelCodes = pgTable(
  'vehicle_model_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 50 }).notNull(),
    mandmCode: varchar('mandm_code', { length: 50 }),
    description: varchar('description', { length: 200 }),
    modelYear: integer('model_year'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    modelIdIdx: index('idx_vehicle_model_codes_model_id').on(t.modelId),
    uniqueCodeYearPerModel: uniqueIndex('uq_vehicle_model_code_per_model_year').on(
      t.modelId,
      t.code,
      t.modelYear,
    ),
  }),
);

export const vehicleModelCodesRelations = relations(vehicleModelCodes, ({ one }) => ({
  model: one(vehicleModels, {
    fields: [vehicleModelCodes.modelId],
    references: [vehicleModels.id],
  }),
}));

export type VehicleModelCode = typeof vehicleModelCodes.$inferSelect;
export type NewVehicleModelCode = typeof vehicleModelCodes.$inferInsert;
