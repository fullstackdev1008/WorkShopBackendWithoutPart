import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicles } from './vehicles';
import { qcInspections } from './qcInspections';
import { vehicleCheckIns } from './vehicleCheckIns';
import { users } from './users';
import { jobCardItems } from './jobCardItems';
import { franchiseServiceDepartments } from './franchiseServiceDepartments';
import { jobCardStatusEnum, jobCardPriorityEnum, acceptanceChannelEnum, evolveSyncStatusEnum } from './enums';

export const jobCards = pgTable(
  'job_cards',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    inspectionId: uuid('inspection_id')
      .references(() => qcInspections.id),

    vehicleCheckInId: uuid('vehicle_check_in_id')
      .references(() => vehicleCheckIns.id),

    status: jobCardStatusEnum('status').notNull().default('DRAFT'),

    // Set when an estimate-affecting edit invalidates a COMPLETED parts
    // confirmation while the job-card status is preserved (the PARTS_CONFIRMED
    // case). Blocks Share Estimate until re-confirmed; cleared automatically when
    // zero pending part requests remain (checkAndConfirmJobCard). False for the
    // post-share regression case, where the status itself drives the block.
    partsReconfirmationRequired: boolean('parts_reconfirmation_required').notNull().default(false),

    serviceType: varchar('service_type', { length: 100 }),
    serviceCategory: varchar('service_category', { length: 100 }),

    // Evolve RO <JobType> code (AI-1). Nullable: historical rows and job cards
    // created before a Job Type is chosen stay NULL and fall back to the
    // existing 'INT' default at RO-push time. The value stored here is a code
    // from the job_types lookup cache — never a hardcoded/guessed value.
    jobType: varchar('job_type', { length: 50 }),

    // Evolve RO Franchise / Service Dept (AI-3). References the chosen labeled
    // franchise_service_departments pair (the leaf); FranchiseSeqID + SDNumber
    // are derived from it at RO-push time. NULL → the existing '1' / '1' default.
    franchiseServiceDeptId: uuid('franchise_service_dept_id').references(
      () => franchiseServiceDepartments.id,
      { onDelete: 'set null' },
    ),

    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).default('0'),
    taxLabel: varchar('tax_label', { length: 20 }).notNull().default('GST'),
    taxPercentage: numeric('tax_percentage', { precision: 5, scale: 2 }).default('18'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).default('0'),
    totalEstimate: numeric('total_estimate', { precision: 12, scale: 2 }).default('0'),
    currencyCode: varchar('currency_code', { length: 3 }).notNull().default('ZAR'),

    approvalToken: varchar('approval_token', { length: 64 }).unique(),

    sharedAt: timestamp('shared_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    // Acceptance provenance (Phase 4 Step 8). acceptedBy is the staff member who
    // accepted on the customer's behalf (e.g. a warranty clerk); null when the
    // customer approved via the public link. acceptanceChannel records which path.
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    acceptanceChannel: acceptanceChannelEnum('acceptance_channel'),
    modificationNote: text('modification_note'),

    assignedTechnicianId: uuid('assigned_technician_id').references(() => users.id, { onDelete: 'set null' }),
    estimatedHours: numeric('estimated_hours', { precision: 6, scale: 2 }),
    priority: jobCardPriorityEnum('priority'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    // Phase 7 — Foreman sign-off before QC Out (Johan 9-June).
    // When the last technician item completes, the card moves to
    // FOREMAN_REVIEW; foreman either signs off (→ COMPLETED → eligible
    // for QC Out) or rejects with a reason (→ IN_PROGRESS again).
    foremanSignedOffBy: uuid('foreman_signed_off_by').references(() => users.id, { onDelete: 'set null' }),
    foremanSignedOffAt: timestamp('foreman_signed_off_at', { withTimezone: true }),
    // base64 data URLs can be tens of KB — TEXT, not VARCHAR.
    foremanSignatureUrl: text('foreman_signature_url'),
    foremanRejectionReason: text('foreman_rejection_reason'),
    foremanRejectedAt: timestamp('foreman_rejected_at', { withTimezone: true }),

    // ── Evolve RO sync (DORMANT — future use; see jobCardEvolveSync.service.ts) ──
    // All nullable & unused while EVOLVE_JOB_CARD_SYNC_ENABLED is false. Existing
    // rows stay NULL and no existing query/serialization depends on them.
    //   evolveRoNumber   — Evolve's DMSReferenceNo (=RONumber); authoritative key
    //                      for UPDATE/lookup. NULL ⇒ never created in Evolve.
    //   evolveCrmRoRef   — our correlation ref we send as CRMReferenceNo (for
    //                      reconciliation matching against ROHistoryLookup).
    //   evolveSyncStatus — PENDING / SYNCED / FAILED / DEFERRED.
    //   evolveSyncedAt   — last successful push. evolveLastError — last failure msg.
    evolveRoNumber: varchar('evolve_ro_number', { length: 20 }),
    evolveCrmRoRef: varchar('evolve_crm_ro_ref', { length: 32 }),
    evolveSyncStatus: evolveSyncStatusEnum('evolve_sync_status'),
    evolveSyncedAt: timestamp('evolve_synced_at', { withTimezone: true }),
    evolveLastError: text('evolve_last_error'),
    //   evolveAttemptCount — retryable-failure counter; at the cap the row is
    //                        parked as NEEDS_MANUAL (no further auto-retry).
    //   evolveNextAttemptAt — exponential-backoff gate; reconcile only re-tries
    //                        rows whose window has elapsed. NULL ⇒ eligible now.
    evolveAttemptCount: integer('evolve_attempt_count').default(0),
    evolveNextAttemptAt: timestamp('evolve_next_attempt_at', { withTimezone: true }),

    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vehicleIdIdx: index('idx_job_cards_vehicle_id').on(t.vehicleId),
    statusIdx: index('idx_job_cards_status').on(t.status),
    inspectionIdIdx: index('idx_job_cards_inspection_id').on(t.inspectionId),
    vehicleCheckInIdIdx: index('idx_job_cards_vehicle_check_in_id').on(t.vehicleCheckInId),
    approvalTokenIdx: uniqueIndex('uq_job_cards_approval_token').on(t.approvalToken),
  }),
);

export const jobCardsRelations = relations(jobCards, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [jobCards.vehicleId],
    references: [vehicles.id],
  }),
  inspection: one(qcInspections, {
    fields: [jobCards.inspectionId],
    references: [qcInspections.id],
  }),
  checkIn: one(vehicleCheckIns, {
    fields: [jobCards.vehicleCheckInId],
    references: [vehicleCheckIns.id],
  }),
  items: many(jobCardItems),
}));

export type JobCard = typeof jobCards.$inferSelect;
export type NewJobCard = typeof jobCards.$inferInsert;
