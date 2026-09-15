import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { jobCardItems } from './jobCardItems';
import { vehicles } from './vehicles';
import { customers } from './customers';
import { users } from './users';
import { warrantyStatusEnum } from './enums';

// One row per replaced part flagged as warranty. Tag-no is a server-
// generated, monotonic identifier (WT-NNNNN) used on the printable tag
// attached to the physical part. Status flows HELD → PENDING_APPROVAL →
// APPROVED → SCRAPPED (or → REJECTED from PENDING_APPROVAL).
export const warrantyParts = pgTable(
  'warranty_parts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tagNo: varchar('tag_no', { length: 20 }).notNull().unique(),
    jobCardItemId: uuid('job_card_item_id').references(() => jobCardItems.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    partName: text('part_name').notNull(),
    partNumber: text('part_number'),
    warrantyClaimNo: varchar('warranty_claim_no', { length: 60 }),
    warrantyOem: varchar('warranty_oem', { length: 120 }),
    technicianId: uuid('technician_id').references(() => users.id, { onDelete: 'set null' }),
    removedAt: timestamp('removed_at', { withTimezone: true }).notNull().defaultNow(),
    status: warrantyStatusEnum('status').notNull().default('HELD'),
    approvalDocUrl: text('approval_doc_url'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    scrappedAt: timestamp('scrapped_at', { withTimezone: true }),
    scrappedBy: uuid('scrapped_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('idx_warranty_status').on(t.status),
    vehicleIdx: index('idx_warranty_vehicle').on(t.vehicleId),
    customerIdx: index('idx_warranty_customer').on(t.customerId),
    removedIdx: index('idx_warranty_removed').on(t.removedAt),
  }),
);

export const warrantyPartsRelations = relations(warrantyParts, ({ one }) => ({
  item: one(jobCardItems, { fields: [warrantyParts.jobCardItemId], references: [jobCardItems.id] }),
  vehicle: one(vehicles, { fields: [warrantyParts.vehicleId], references: [vehicles.id] }),
  customer: one(customers, { fields: [warrantyParts.customerId], references: [customers.id] }),
  technician: one(users, { fields: [warrantyParts.technicianId], references: [users.id] }),
}));

export type WarrantyPart = typeof warrantyParts.$inferSelect;
export type NewWarrantyPart = typeof warrantyParts.$inferInsert;
