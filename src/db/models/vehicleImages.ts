import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  numeric,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicles } from './vehicles';

export const vehicleImages = pgTable('vehicle_images', {
  id: uuid('id').defaultRandom().primaryKey(),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  imageCategory: varchar('image_category', { length: 50 }),
  imagePath: varchar('image_path', { length: 500 }).notNull(),
  // Phase 8 — compliance metadata (Johan 9-June, item 3.3). Captured by the
  // client at the moment the photo is taken. Server validates that
  // captured_at is recent enough to prove the photo wasn't a gallery pick.
  gpsLat: numeric('gps_lat', { precision: 10, scale: 7 }),
  gpsLng: numeric('gps_lng', { precision: 10, scale: 7 }),
  gpsAccuracyM: integer('gps_accuracy_m'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  deviceUserAgent: varchar('device_user_agent', { length: 255 }),
  addressText: varchar('address_text', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const vehicleImagesRelations = relations(vehicleImages, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleImages.vehicleId],
    references: [vehicles.id],
  }),
}));

export type VehicleImage = typeof vehicleImages.$inferSelect;
export type NewVehicleImage = typeof vehicleImages.$inferInsert;
