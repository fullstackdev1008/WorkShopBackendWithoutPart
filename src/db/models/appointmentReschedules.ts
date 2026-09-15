import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { appointments } from './appointments';
import { users } from './users';

export const appointmentReschedules = pgTable(
  'appointment_reschedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    previousDate: date('previous_date').notNull(),
    previousTime: varchar('previous_time', { length: 5 }).notNull(),
    newDate: date('new_date').notNull(),
    newTime: varchar('new_time', { length: 5 }).notNull(),
    reason: text('reason'),
    rescheduledBy: uuid('rescheduled_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appointmentIdIdx: index('idx_appointment_reschedules_appointment_id').on(t.appointmentId),
  }),
);

export type AppointmentReschedule = typeof appointmentReschedules.$inferSelect;
