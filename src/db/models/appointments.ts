import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  date,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { customers } from './customers';
import { vehicles } from './vehicles';
import { users } from './users';
import { vehicleCheckIns } from './vehicleCheckIns';
import { companies } from './companies';
import { workshopBays } from './workshopBays';
import { appointmentStatusEnum } from './enums';

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    bookingRef: varchar('booking_ref', { length: 20 }).notNull(),

    customerId: uuid('customer_id').references(() => customers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    serviceAdvisorId: uuid('service_advisor_id').references(() => users.id),

    serviceType: varchar('service_type', { length: 50 }).notNull(),
    complaints: jsonb('complaints').$type<string[]>().notNull(),
    estimatedDurationMinutes: integer('estimated_duration_minutes').notNull().default(150),

    appointmentDate: date('appointment_date').notNull(),
    appointmentTime: varchar('appointment_time', { length: 5 }).notNull(),

    // Optional physical bay reservation (Bay & Time-Slot scheduling). NULL for
    // legacy/capacity-slot appointments; set for bay-scheduled bookings, whose
    // occupation window is [appointmentTime, appointmentTime + duration).
    bayId: uuid('bay_id').references(() => workshopBays.id),

    pickupRequired: boolean('pickup_required').notNull().default(false),
    pickupAddress: text('pickup_address'),

    internalNotes: text('internal_notes'),

    status: appointmentStatusEnum('status').notNull().default('BOOKED'),

    checkInId: uuid('check_in_id').references(() => vehicleCheckIns.id),

    odometerReading: integer('odometer_reading'),

    whatsappSent: boolean('whatsapp_sent').notNull().default(false),
    emailSent: boolean('email_sent').notNull().default(false),

    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    rescheduleCount: integer('reschedule_count').notNull().default(0),
    originalDate: date('original_date'),
    originalTime: varchar('original_time', { length: 5 }),
    lastRescheduledAt: timestamp('last_rescheduled_at', { withTimezone: true }),

    // Snapshot of the company this appointment was booked under (Phase B2).
    // Reporting/context only — NOT authoritative for vehicle ownership.
    companyId: uuid('company_id').references(() => companies.id),

    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    bookingRefIdx: uniqueIndex('uq_appointments_booking_ref').on(t.bookingRef),
    customerIdIdx: index('idx_appointments_customer_id').on(t.customerId),
    vehicleIdIdx: index('idx_appointments_vehicle_id').on(t.vehicleId),
    dateIdx: index('idx_appointments_date').on(t.appointmentDate),
    statusIdx: index('idx_appointments_status').on(t.status),
    dateTimeIdx: index('idx_appointments_date_time').on(t.appointmentDate, t.appointmentTime),
    companyIdIdx: index('idx_appointments_company_id').on(t.companyId),
    bayDateIdx: index('idx_appointments_bay_date').on(t.bayId, t.appointmentDate),
  }),
);

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  customer: one(customers, {
    fields: [appointments.customerId],
    references: [customers.id],
  }),
  vehicle: one(vehicles, {
    fields: [appointments.vehicleId],
    references: [vehicles.id],
  }),
  serviceAdvisor: one(users, {
    fields: [appointments.serviceAdvisorId],
    references: [users.id],
    relationName: 'appointmentServiceAdvisor',
  }),
  createdByUser: one(users, {
    fields: [appointments.createdBy],
    references: [users.id],
    relationName: 'appointmentCreatedBy',
  }),
  checkIn: one(vehicleCheckIns, {
    fields: [appointments.checkInId],
    references: [vehicleCheckIns.id],
  }),
  bay: one(workshopBays, {
    fields: [appointments.bayId],
    references: [workshopBays.id],
  }),
}));

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
