import { z } from 'zod';

// ─── Enums ──────────────────────────────────────────────────────────────────
const QC_CATEGORIES = ['EXTERIOR', 'INTERIOR', 'BRAKE'] as const;
const QC_ITEM_RESULTS = ['PASS', 'FAIL', 'NA'] as const;
const QC_OVERALL_STATUSES = ['PASS', 'CONDITIONAL', 'FAIL'] as const;
const QC_PRIORITIES = ['BASIC', 'STANDARD', 'EXPRESS', 'URGENT'] as const;
const QC_BRAKE_PERFORMANCE = ['GOOD', 'AVERAGE', 'POOR'] as const;
const QC_BRAKE_NV = ['NONE', 'LOW', 'HIGH'] as const;

// ─── Dashboard Query ────────────────────────────────────────────────────────
export const qcDashboardQuerySchema = z.object({
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
  // PENDING replaced URGENT/DELAYED in the UI (3 tabs: All / Pending / Completed).
  // The old values stay accepted so a bookmarked URL or older client still works.
  filter: z.enum(['ALL', 'PENDING', 'URGENT', 'DELAYED', 'COMPLETED']).default('ALL'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  dateFrom: z
    .preprocess(v => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be in YYYY-MM-DD format').optional()),
  dateTo: z
    .preprocess(v => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be in YYYY-MM-DD format').optional()),
});

// ─── Create Inspection ──────────────────────────────────────────────────────
export const createInspectionSchema = z.object({
  vehicleId: z
    .string({ required_error: 'Vehicle ID is required' })
    .uuid(),
  serviceType: z.string().max(50).nullish(),
  priority: z.enum(QC_PRIORITIES).default('STANDARD'),
});

// ─── Param Schemas ──────────────────────────────────────────────────────────
export const inspectionIdParamSchema = z.object({
  id: z.string().uuid('Invalid inspection ID format'),
});

export const inspectionItemPhotoParamSchema = z.object({
  inspectionId: z.string().uuid('Invalid inspection ID format'),
  itemId: z.string().uuid('Invalid item ID format'),
});

export const inspectionItemPhotoIdParamSchema = z.object({
  inspectionId: z.string().uuid('Invalid inspection ID format'),
  itemId: z.string().uuid('Invalid item ID format'),
  photoId: z.string().uuid('Invalid photo ID format'),
});

// ─── Save Step Items ────────────────────────────────────────────────────────
export const saveStepItemsSchema = z.object({
  category: z.enum(QC_CATEGORIES, {
    required_error: 'Category is required',
  }),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid('Invalid item ID'),
        result: z.enum(QC_ITEM_RESULTS).nullable(),
        comment: z.string().nullish(),
      }),
    )
    .min(1, 'At least one item is required'),
});

// ─── Save Final Confirmation ────────────────────────────────────────────────
export const saveConfirmationSchema = z.object({
  components: z.array(z.object({
    majorComponent: z.string().max(200).optional(),
    itemNumber: z.string().max(100).optional(),
    comment: z.string().optional(),
  })).optional(),
  rework: z.object({
    majorComponent: z.string().max(200).optional(),
    technician: z.string().max(200).optional(),
    itemNumber: z.string().max(100).optional(),
    comments: z.string().optional(),
  }).optional(),
  timeIn: z.string().optional(),
  timeOut: z.string().optional(),
});

// ─── Save Findings ──────────────────────────────────────────────────────────
export const saveFindingsSchema = z.object({
  brakePerformance: z.enum(QC_BRAKE_PERFORMANCE).nullish(),
  brakeNoise: z.enum(QC_BRAKE_NV).nullish(),
  brakeVibration: z.enum(QC_BRAKE_NV).nullish(),
  overallStatus: z.enum(QC_OVERALL_STATUSES, {
    required_error: 'Overall QC status is required',
  }),
  overrideJustification: z.string().nullish(),
  finalRemarks: z.string().nullish(),
});
