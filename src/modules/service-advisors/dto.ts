import { z } from 'zod';

// ─── Dashboard Query ────────────────────────────────────────────────────────
export const saDashboardQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/, 'Page must be a number')
    .transform(Number)
    .default('1'),
  limit: z
    .string()
    .regex(/^\d+$/, 'Limit must be a number')
    .transform(Number)
    .default('10'),
  filter: z
    .enum(['ALL', 'INSPECTION_DONE', 'JOB_CARD_DRAFT', 'PENDING_APPROVAL', 'IN_SERVICE', 'READY_FOR_BILLING'])
    .default('ALL'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  dateFrom: z
    .preprocess(v => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be in YYYY-MM-DD format').optional()),
  dateTo: z
    .preprocess(v => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be in YYYY-MM-DD format').optional()),
});

// ─── Param Schemas ──────────────────────────────────────────────────────────
export const vehicleIdParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID format'),
});

export const jobCardIdParamSchema = z.object({
  id: z.string().uuid('Invalid job card ID format'),
});

export const jobCardItemIdParamSchema = z.object({
  id: z.string().uuid('Invalid job card ID format'),
  itemId: z.string().uuid('Invalid item ID format'),
});

// ─── Shared job-item sub-schema ─────────────────────────────────────────────
const jobItemSchema = z.object({
  jobDescription: z.string().min(1, 'Job description is required').max(500),
  partsRequired: z.string().max(500).nullish(),
  partsCost: z.coerce.number().min(0).default(0),
  labourCost: z.coerce.number().min(0).default(0),
  quantity: z.coerce.number().int().min(1).default(1),
  // Manual Part Price Override (TrueGear-only). Both optional/backward compatible;
  // >= 0, max 2 decimal places. evolveUnitPrice preserves the original price;
  // manualUnitPrice (null clears the override). Effective = manual ?? evolve.
  evolveUnitPrice: z.coerce.number().min(0).multipleOf(0.01, 'Max 2 decimal places').nullish(),
  manualUnitPrice: z.coerce.number().min(0).multipleOf(0.01, 'Max 2 decimal places').nullish(),
  // Per-item estimated hours (Phase 2 — Labour lines). Optional/backward
  // compatible; when present it takes precedence over the job-group value.
  estimatedHours: z.coerce.number().min(0).max(999.99).nullish(),
  // Free-text line note (Phase 2 — Labour lines). Optional.
  notes: z.string().max(500).nullish(),
  isWarrantyClaim: z.coerce.boolean().optional().default(false),
  warrantyClaimNo: z.string().max(60).nullish(),
  warrantyOem: z.string().max(120).nullish(),
});

// ─── Shared job-group sub-schema ─────────────────────────────────────────────
const jobGroupSchema = z.object({
  serviceType: z.string().max(100).nullish(),
  serviceCategory: z.string().max(100).nullish(),
  // Per-job Evolve Job Type code (from the job_types lookup). Optional — blank
  // falls back to the 'INT' default at RO push. No guessed values.
  jobType: z.string().max(50).nullish(),
  // Per-job Evolve AR account number → ROJobHeader <ARAccountNo>. Chosen from
  // the customer's accounts when the Job Type requires one (the UI requires it
  // for CST). Optional here: a job that needs no account simply has none, and
  // an over-strict schema would reject every existing client. Length matches
  // customers' ar_account_number column.
  arAccountNo: z.string().max(40).nullish(),
  // Per-job estimated labour hours → Evolve ROJobHeader <HoursEstimate> (and the
  // labour line HoursSold fallback). Optional; 0–999.99.
  estimatedHours: z.coerce.number().min(0).max(999.99).nullish(),
  items: z.array(jobItemSchema).min(1, 'Each job must have at least one item'),
});

// ─── Create Job Card ────────────────────────────────────────────────────────
export const createJobCardSchema = z.object({
  inspectionId: z.string().uuid().nullish(),
  jobs: z.array(jobGroupSchema).min(1, 'At least one job is required'),
  taxLabel: z.string().min(1).max(20).default('VAT'),
  taxPercentage: z.number().min(0).max(100).default(15),
  currencyCode: z.string().length(3).default('ZAR'),
  // Evolve RO <JobType> code (AI-1). Optional + backward compatible: omitted →
  // NULL → 'INT' default at RO push. A free-form code string (a value from the
  // job_types lookup cache), not a hardcoded enum. No guessed values here.
  jobType: z.string().max(50).nullish(),
});

// ─── Update Job Card ────────────────────────────────────────────────────────
export const updateJobCardSchema = z.object({
  jobs: z.array(jobGroupSchema).min(1, 'At least one job is required'),
  taxLabel: z.string().min(1).max(20).default('VAT'),
  taxPercentage: z.number().min(0).max(100).default(15),
  currencyCode: z.string().length(3).default('ZAR'),
  // Evolve RO <JobType> code (AI-1). Optional; see createJobCardSchema.
  jobType: z.string().max(50).nullish(),
});

// ─── Update Vehicle Status ──────────────────────────────────────────────────
export const updateVehicleStatusSchema = z.object({
  status: z.enum([
    'Job Card (Pending Cust. Approval)',
    'Job Card (Full Cust. Approval)',
    'In Service',
    'Ready for Billing',
    'Completed',
  ]),
});

// ─── Add Service History ────────────────────────────────────────────────────
export const addServiceHistorySchema = z.object({
  serviceType: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  technicianName: z.string().max(150).nullish(),
  totalCost: z.number().min(0).nullish(),
  duration: z.string().max(50).nullish(),
  notes: z.string().nullish(),
});
