import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleMakes } from './vehicleMakes';
import { vehicleModels } from './vehicleModels';
import { serviceTypes } from './serviceTypes';
import { users } from './users';

export const modelServiceTypeAssignments = pgTable(
  'model_service_type_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    makeId: uuid('make_id')
      .notNull()
      .references(() => vehicleMakes.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'cascade' }),
    serviceTypeId: uuid('service_type_id')
      .notNull()
      .references(() => serviceTypes.id, { onDelete: 'cascade' }),
    serviceCategoryId: uuid('service_category_id')
      .references(() => serviceTypes.id, { onDelete: 'cascade' }),
    // Third cascade level (Make → Model → Model Code / "Series"). Stores the
    // Evolve MM code (e.g. "18665355") the admin picked, so job-card auto-load
    // matches parts by the stable vehicles.model_code instead of the fragile
    // free-text model name. Nullable: legacy rows / models with no code.
    modelCode: varchar('model_code', { length: 50 }),
    partCode: varchar('part_code', { length: 50 }).notNull().default(''),
    partName: varchar('part_name', { length: 200 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    makeIdx: index('idx_msta_make_id').on(t.makeId),
    modelIdx: index('idx_msta_model_id').on(t.modelId),
    serviceTypeIdx: index('idx_msta_service_type_id').on(t.serviceTypeId),
    modelCodeIdx: index('idx_msta_model_code').on(t.modelCode),
  }),
);

export const modelServiceTypeAssignmentsRelations = relations(modelServiceTypeAssignments, ({ one }) => ({
  make: one(vehicleMakes, {
    fields: [modelServiceTypeAssignments.makeId],
    references: [vehicleMakes.id],
  }),
  model: one(vehicleModels, {
    fields: [modelServiceTypeAssignments.modelId],
    references: [vehicleModels.id],
  }),
  serviceType: one(serviceTypes, {
    fields: [modelServiceTypeAssignments.serviceTypeId],
    references: [serviceTypes.id],
  }),
}));

export type ModelServiceTypeAssignment = typeof modelServiceTypeAssignments.$inferSelect;
export type NewModelServiceTypeAssignment = typeof modelServiceTypeAssignments.$inferInsert;
