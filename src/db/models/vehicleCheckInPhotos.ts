import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  numeric,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleCheckIns } from './vehicleCheckIns';
import { vehiclePhotoTypeEnum } from './enums';

export const vehicleCheckInPhotos = pgTable(
  'vehicle_check_in_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    vehicleCheckInId: uuid('vehicle_check_in_id')
      .notNull()
      .references(() => vehicleCheckIns.id, { onDelete: 'cascade' }),

    photoType: vehiclePhotoTypeEnum('photo_type').notNull(),

    imageUrl: varchar('image_url', { length: 500 }).notNull(),

    // Phase 8 — compliance metadata (3.3). Mirrors vehicle_images.
    gpsLat: numeric('gps_lat', { precision: 10, scale: 7 }),
    gpsLng: numeric('gps_lng', { precision: 10, scale: 7 }),
    gpsAccuracyM: integer('gps_accuracy_m'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    deviceUserAgent: varchar('device_user_agent', { length: 255 }),
    addressText: varchar('address_text', { length: 500 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    checkInIdIdx: index('idx_vehicle_check_in_photos_check_in_id').on(t.vehicleCheckInId),
  }),
);

export const vehicleCheckInPhotosRelations = relations(vehicleCheckInPhotos, ({ one }) => ({
  checkIn: one(vehicleCheckIns, {
    fields: [vehicleCheckInPhotos.vehicleCheckInId],
    references: [vehicleCheckIns.id],
  }),
}));

export type VehicleCheckInPhoto = typeof vehicleCheckInPhotos.$inferSelect;
export type NewVehicleCheckInPhoto = typeof vehicleCheckInPhotos.$inferInsert;
