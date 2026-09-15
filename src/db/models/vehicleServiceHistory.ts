import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicles } from './vehicles';

export const vehicleServiceHistory = pgTable(
  'vehicle_service_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    serviceType: varchar('service_type', { length: 100 }).notNull(),
    serviceDate: date('service_date').notNull(),
    technicianName: varchar('technician_name', { length: 150 }),

    totalCost: numeric('total_cost', { precision: 12, scale: 2 }),
    duration: varchar('duration', { length: 50 }),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vehicleIdIdx: index('idx_vehicle_service_history_vehicle_id').on(t.vehicleId),
    serviceDateIdx: index('idx_vehicle_service_history_date').on(t.serviceDate),
  }),
);

export const vehicleServiceHistoryRelations = relations(vehicleServiceHistory, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleServiceHistory.vehicleId],
    references: [vehicles.id],
  }),
}));

export type VehicleServiceHistoryType = typeof vehicleServiceHistory.$inferSelect;
export type NewVehicleServiceHistory = typeof vehicleServiceHistory.$inferInsert;
