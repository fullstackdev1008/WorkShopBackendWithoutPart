import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  numeric,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { jobCards } from './jobCards';
import { users } from './users';
import { jobCardPriorityEnum } from './enums';

export const jobCardItems = pgTable(
  'job_card_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    jobCardId: uuid('job_card_id')
      .notNull()
      .references(() => jobCards.id, { onDelete: 'cascade' }),

    jobDescription: varchar('job_description', { length: 500 }).notNull(),
    partsRequired: varchar('parts_required', { length: 500 }),

    serviceType: varchar('service_type', { length: 100 }),
    serviceCategory: varchar('service_category', { length: 100 }),

    // 1-based index of the parent job (within body.jobs) this item belongs to.
    // Restores the job grouping the create/edit flatten discards, so the Evolve
    // RO sync can emit one <ROJobHeader><RowDetails> per job. Default 1 → single
    // job (today's behaviour).
    jobGroup: integer('job_group').notNull().default(1),

    // Per-job Evolve Job Type code (from the job_types lookup). All items of a
    // job share it; drives that job's <JobType> in its ROJobHeader block. NULL →
    // 'INT' default at RO push.
    jobType: varchar('job_type', { length: 50 }),

    // parts_cost holds the EFFECTIVE unit price (manual override ?? Evolve price)
    // so all estimate / invoice / tax / total logic keeps using it unchanged.
    partsCost: numeric('parts_cost', { precision: 12, scale: 2 }).default('0'),
    // Manual Part Price Override (TrueGear-only; never pushed to Evolve):
    //   evolveUnitPrice   — the original price from Evolve/auto-load (preserved)
    //   manualUnitPrice   — the SA's override; NULL means "use the Evolve price"
    //   isPriceOverridden — true when a manual price is in effect
    //   effective = manualUnitPrice ?? evolveUnitPrice  (== parts_cost)
    evolveUnitPrice: numeric('evolve_unit_price', { precision: 12, scale: 2 }),
    manualUnitPrice: numeric('manual_unit_price', { precision: 12, scale: 2 }),
    isPriceOverridden: boolean('is_price_overridden').notNull().default(false),
    labourCost: numeric('labour_cost', { precision: 12, scale: 2 }).default('0'),
    quantity: integer('quantity').notNull().default(1),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).default('0'),

    // Free-text note for a line (Phase 2 — Labour section). Nullable; parts leave
    // it NULL. Distinct from completion_notes/diagnosis_notes (technician flow).
    notes: varchar('notes', { length: 500 }),

    sortOrder: integer('sort_order').notNull().default(0),

    isApprovedByCustomer: boolean('is_approved_by_customer'),

    assignedTechnicianId: uuid('assigned_technician_id').references(() => users.id, { onDelete: 'set null' }),
    estimatedHours: numeric('estimated_hours', { precision: 6, scale: 2 }),
    priority: jobCardPriorityEnum('priority'),

    // Evolve labour allocation (ROJobDetails / PostingType=L). Captured per item
    // at technician assignment and pushed via the RO UPDATE sync.
    //   hoursWorked  → <HoursWorked> (actual hours, decimal e.g. 0.25)
    //   hoursSold    → <HoursSold>   (billed hours; may differ for warranty/goodwill)
    //   evolveLineNumber/evolveLineStatus persist the labour line's identity so a
    //   re-send updates the same line (LineStatus=U) instead of appending a new one.
    hoursWorked: numeric('hours_worked', { precision: 6, scale: 2 }),
    hoursSold: numeric('hours_sold', { precision: 6, scale: 2 }),
    evolveLineNumber: integer('evolve_line_number'),
    evolveLineStatus: varchar('evolve_line_status', { length: 1 }),
    // Evolve AR account this job is charged to → <ROJobHeader><ARAccountNo>.
    // Chosen by the operator from the customer's accounts (a customer can hold
    // one per department type), and stored per job because both the triggering
    // Job Type and <ARAccountNo> live at job grain. NULL = none selected → the
    // RO builder omits the element rather than sending a blank. Migration 0068.
    evolveArAccountNo: varchar('evolve_ar_account_no', { length: 40 }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    completionNotes: text('completion_notes'),
    reworkNotes: text('rework_notes'),
    reworkCount: integer('rework_count').notNull().default(0),

    // Phase 3 — Diagnosis phase + technician signature
    diagnosisNotes: text('diagnosis_notes'),
    diagnosedAt: timestamp('diagnosed_at', { withTimezone: true }),
    diagnosedBy: uuid('diagnosed_by').references(() => users.id, { onDelete: 'set null' }),
    signatureImageUrl: text('signature_image_url'),

    // Phase 4 — idempotency for the labour-overrun cron.
    alerted80pctAt: timestamp('alerted_80pct_at', { withTimezone: true }),
    alerted100pctAt: timestamp('alerted_100pct_at', { withTimezone: true }),

    // Phase 6 — warranty-claim flag captured by the SA at job-card creation.
    // When true, technician completion auto-creates a warranty_parts row.
    isWarrantyClaim: boolean('is_warranty_claim').notNull().default(false),
    warrantyClaimNo: varchar('warranty_claim_no', { length: 60 }),
    warrantyOem: varchar('warranty_oem', { length: 120 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobCardIdIdx: index('idx_job_card_items_job_card_id').on(t.jobCardId),
  }),
);

export const jobCardItemsRelations = relations(jobCardItems, ({ one }) => ({
  jobCard: one(jobCards, {
    fields: [jobCardItems.jobCardId],
    references: [jobCards.id],
  }),
}));

export type JobCardItem = typeof jobCardItems.$inferSelect;
export type NewJobCardItem = typeof jobCardItems.$inferInsert;
