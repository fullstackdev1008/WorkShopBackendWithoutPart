import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicles } from './vehicles';

export const vehicleAccessories = pgTable(
  'vehicle_accessories',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    accessoryCode: varchar('accessory_code', { length: 100 }).notNull(),
    accessoryName: varchar('accessory_name', { length: 200 }).notNull(),
    accessoryType: varchar('accessory_type', { length: 50 }),

    quantity: integer('quantity').default(1),

    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
    totalPrice: numeric('total_price', { precision: 12, scale: 2 }),

    isFactoryFitted: boolean('is_factory_fitted').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    vehicleIdIdx: index('idx_vehicle_accessories_vehicle_id').on(t.vehicleId),
    uniqueAccessory: uniqueIndex('uq_vehicle_accessory').on(
      t.vehicleId,
      t.accessoryCode,
    ),
  }),
);

export const vehicleAccessoriesRelations = relations(vehicleAccessories, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleAccessories.vehicleId],
    references: [vehicles.id],
  }),
}));

export type VehicleAccessory = typeof vehicleAccessories.$inferSelect;
export type NewVehicleAccessory = typeof vehicleAccessories.$inferInsert;
