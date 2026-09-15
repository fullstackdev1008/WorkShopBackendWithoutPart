import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleCheckIns } from './vehicleCheckIns';
import { users } from './users';
import { qcInspectionItems } from './qcInspectionItems';
import { qcInspectionStatusEnum, qcOverallStatusEnum } from './enums';

export const qcInspections = pgTable(
  'qc_inspections',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    vehicleCheckInId: uuid('vehicle_check_in_id')
      .notNull()
      .references(() => vehicleCheckIns.id, { onDelete: 'cascade' }),

    serviceType: varchar('service_type', { length: 50 }),
    priority: varchar('priority', { length: 20 }).notNull().default('STANDARD'),

    status: qcInspectionStatusEnum('status').notNull().default('PENDING'),
    currentStep: integer('current_step').notNull().default(1),

    // Brake Test Summary
    brakePerformance: varchar('brake_performance', { length: 20 }),
    brakeNoise: varchar('brake_noise', { length: 20 }),
    brakeVibration: varchar('brake_vibration', { length: 20 }),

    // Overall Findings
    overallStatus: qcOverallStatusEnum('overall_status'),
    overrideJustification: text('override_justification'),
    finalRemarks: text('final_remarks'),

    // Final Confirmation
    signatureUrl: varchar('signature_url', { length: 500 }),
    timeIn: timestamp('time_in', { withTimezone: true }),
    timeOut: timestamp('time_out', { withTimezone: true }),

    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdBy: uuid('created_by').references(() => users.id),
    completedBy: uuid('completed_by').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vehicleCheckInIdIdx: index('idx_qc_inspections_vehicle_check_in_id').on(t.vehicleCheckInId),
    statusIdx: index('idx_qc_inspections_status').on(t.status),
  }),
);

export const qcInspectionsRelations = relations(qcInspections, ({ one, many }) => ({
  vehicleCheckIn: one(vehicleCheckIns, {
    fields: [qcInspections.vehicleCheckInId],
    references: [vehicleCheckIns.id],
  }),
  items: many(qcInspectionItems),
}));

export type QcInspection = typeof qcInspections.$inferSelect;
export type NewQcInspection = typeof qcInspections.$inferInsert;
