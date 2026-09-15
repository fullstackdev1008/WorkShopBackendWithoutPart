import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicles } from './vehicles';
import { vehicleCheckInPhotos } from './vehicleCheckInPhotos';
import { qcInspections } from './qcInspections';
import { users } from './users';
import { vehicleCheckInStatusEnum, fuelLevelEnum, bayCategoryEnum } from './enums';

export const vehicleCheckIns = pgTable(
  'vehicle_check_ins',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    checkInNumber: varchar('check_in_number', { length: 50 }),

    odometerReading: integer('odometer_reading').notNull(),

    status: vehicleCheckInStatusEnum('status').notNull().default('IN_QUEUE'),

    checkInTime: timestamp('check_in_time', { withTimezone: true }).notNull().defaultNow(),

    isActive: boolean('is_active').notNull().default(true),

    // Record-level shop marker (set at gate entry). Drives shop scoping for
    // foreman/controller roles. Reuses bay_category vocabulary (SERVICE /
    // MAJOR / PDI). Nullable so existing rows stay valid pre-backfill; new
    // rows are tagged at confirm-entry. This is the spine the whole flow
    // (job cards, allocations, QC, washbay) derives its shop from.
    shop: bayCategoryEnum('shop'),

    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    notes: text('notes'),

    // Phase 1 — richer arrival capture
    receivingNo: varchar('receiving_no', { length: 20 }),
    driverName: varchar('driver_name', { length: 150 }),
    driverPhone: varchar('driver_phone', { length: 30 }),
    driverLicenceNo: varchar('driver_licence_no', { length: 50 }),
    fuelLevel: fuelLevelEnum('fuel_level'),
    damagesNotes: text('damages_notes'),
    complaintText: text('complaint_text'),

    // Canonical RO status — single source of truth for the 15-state flow.
    // Helper setRoStatus() is the only writer; never set directly.
    roStatus: varchar('ro_status', { length: 40 }),
    roStatusAt: timestamp('ro_status_at', { withTimezone: true }),
    roStatusBy: uuid('ro_status_by').references(() => users.id, { onDelete: 'set null' }),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    vehicleIdIdx: index('idx_vehicle_check_ins_vehicle_id').on(t.vehicleId),
    statusIdx: index('idx_vehicle_check_ins_status').on(t.status),
    checkInTimeIdx: index('idx_vehicle_check_ins_check_in_time').on(t.checkInTime),
    shopIdx: index('idx_vehicle_check_ins_shop').on(t.shop),
  }),
);

export const vehicleCheckInsRelations = relations(vehicleCheckIns, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleCheckIns.vehicleId],
    references: [vehicles.id],
  }),
  photos: many(vehicleCheckInPhotos),
  qcInspections: many(qcInspections),
}));

export type VehicleCheckIn = typeof vehicleCheckIns.$inferSelect;
export type NewVehicleCheckIn = typeof vehicleCheckIns.$inferInsert;
