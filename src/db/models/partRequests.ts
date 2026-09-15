import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { jobCards } from './jobCards';
import { jobCardItems } from './jobCardItems';
import { vehicles } from './vehicles';
import { users } from './users';
import { partRequestStatusEnum } from './enums';

export const partRequests = pgTable(
  'part_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    jobCardId: uuid('job_card_id')
      .notNull()
      .references(() => jobCards.id, { onDelete: 'cascade' }),

    jobCardItemId: uuid('job_card_item_id')
      .notNull()
      .references(() => jobCardItems.id, { onDelete: 'cascade' }),

    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    partName: varchar('part_name', { length: 200 }).notNull(),
    partNumber: varchar('part_number', { length: 200 }),
    quantity: integer('quantity').notNull().default(1),

    status: partRequestStatusEnum('status').notNull().default('pending'),
    expectedTime: varchar('expected_time', { length: 100 }),

    // Phase 3 — flags requests raised mid-repair by a technician so the
    // Parts Manager UI can group/filter them separately from pre-share asks.
    requestedByTechnician: boolean('requested_by_technician').notNull().default(false),

    // Pricing captured by Parts Manager at Mark-Available time. Drives the
    // supplementary customer-approval flow when the tech-raised request
    // adds cost beyond the originally-approved estimate.
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
    extraLabourCost: numeric('extra_labour_cost', { precision: 12, scale: 2 }).notNull().default('0'),
    customerApprovalStatus: varchar('customer_approval_status', { length: 20 })
      .notNull()
      .default('NOT_REQUIRED'),  // NOT_REQUIRED | PENDING | APPROVED | REJECTED
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),

    // Auto-assign target: the tech who raised the request gets the
    // supplementary jobCardItems row reassigned to them on customer approval.
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    suppJobCardItemId: uuid('supp_job_card_item_id').references(() => jobCardItems.id, { onDelete: 'set null' }),

    // Phase 7 — technician acceptance step after parts-manager dispatch.
    // Confirms physical handover; rejection (e.g. wrong part) bounces the
    // request back to the parts manager queue with a reason.
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    techRejectedAt: timestamp('tech_rejected_at', { withTimezone: true }),
    techRejectedBy: uuid('tech_rejected_by').references(() => users.id, { onDelete: 'set null' }),
    rejectionReason: varchar('rejection_reason', { length: 500 }),

    updatedBy: uuid('updated_by').references(() => users.id),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobCardIdIdx: index('idx_part_requests_job_card_id').on(t.jobCardId),
    vehicleIdIdx: index('idx_part_requests_vehicle_id').on(t.vehicleId),
    statusIdx: index('idx_part_requests_status').on(t.status),
  }),
);

export const partRequestsRelations = relations(partRequests, ({ one }) => ({
  jobCard: one(jobCards, {
    fields: [partRequests.jobCardId],
    references: [jobCards.id],
  }),
  jobCardItem: one(jobCardItems, {
    fields: [partRequests.jobCardItemId],
    references: [jobCardItems.id],
  }),
  vehicle: one(vehicles, {
    fields: [partRequests.vehicleId],
    references: [vehicles.id],
  }),
  updatedByUser: one(users, {
    fields: [partRequests.updatedBy],
    references: [users.id],
  }),
}));

export type PartRequest = typeof partRequests.$inferSelect;
export type NewPartRequest = typeof partRequests.$inferInsert;
