import { pgTable, uuid, varchar, text, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { invoices } from './invoices';
import { vehicleCheckIns } from './vehicleCheckIns';
import { vehicles } from './vehicles';
import { users } from './users';
import { gatePassStatusEnum } from './enums';

// One ACTIVE gate-pass per invoice. Generated automatically when the
// invoice flips to PAID; redeemed by security at the gate with odometer
// and driver-out signature.
export const gatePasses = pgTable(
  'gate_passes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 20 }).notNull().unique(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    checkInId: uuid('check_in_id').references(() => vehicleCheckIns.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    status: gatePassStatusEnum('status').notNull().default('ACTIVE'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    generatedBy: uuid('generated_by').references(() => users.id, { onDelete: 'set null' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    redeemedBy: uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
    odometerOut: integer('odometer_out'),
    driverOutName: varchar('driver_out_name', { length: 150 }),
    driverOutLicenceImageUrl: text('driver_out_licence_image_url'),
    driverOutSignatureUrl: text('driver_out_signature_url'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    invIdx: index('idx_gate_passes_invoice').on(t.invoiceId),
    checkInIdx: index('idx_gate_passes_check_in').on(t.checkInId),
    statusIdx: index('idx_gate_passes_status').on(t.status),
  }),
);

export const gatePassesRelations = relations(gatePasses, ({ one }) => ({
  invoice: one(invoices, { fields: [gatePasses.invoiceId], references: [invoices.id] }),
  checkIn: one(vehicleCheckIns, { fields: [gatePasses.checkInId], references: [vehicleCheckIns.id] }),
  vehicle: one(vehicles, { fields: [gatePasses.vehicleId], references: [vehicles.id] }),
}));

export type GatePass = typeof gatePasses.$inferSelect;
export type NewGatePass = typeof gatePasses.$inferInsert;
