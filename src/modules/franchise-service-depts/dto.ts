import { z } from 'zod';

// Franchise / Service-Dept pairs (Evolve FranchiseSeqID + SDNumber) with the
// human labels an admin assigns after master-data sync. Numeric values are
// client/Evolve-supplied — never guessed. Labels drive the two job-card
// dropdowns (franchiseLabel groups the Franchise dropdown; serviceDeptLabel is
// the Service Dept option within it).
export const createFsdSchema = z.object({
  franchiseSeqId: z
    .string({ required_error: 'FranchiseSeqID is required' })
    .trim()
    .min(1, 'FranchiseSeqID is required')
    .max(20),
  sdNumber: z.string({ required_error: 'SDNumber is required' }).trim().min(1, 'SDNumber is required').max(20),
  franchiseLabel: z.string().trim().min(1).max(100).nullable().optional(),
  serviceDeptLabel: z.string().trim().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateFsdSchema = z.object({
  franchiseSeqId: z.string().trim().min(1).max(20).optional(),
  sdNumber: z.string().trim().min(1).max(20).optional(),
  franchiseLabel: z.string().trim().min(1).max(100).nullable().optional(),
  serviceDeptLabel: z.string().trim().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const fsdIdParamSchema = z.object({
  id: z.string().uuid('Invalid franchise/service-dept ID format'),
});

export const listFsdQuerySchema = z.object({
  // 'labeled' (default) → only active, fully-labeled pairs (the job-card
  // dropdown source). 'all' → every cached pair incl. unlabeled/inactive (admin).
  scope: z.enum(['labeled', 'all']).optional(),
  // Company (dealership) whose franchises to return. The pairs are fetched per
  // Evolve InterfaceCode, so they belong to one company. Omitted → unfiltered,
  // i.e. exactly the previous behaviour, so existing callers are unaffected.
  // Ignored when scope=all (admin labeling needs to see everything).
  companyId: z.string().uuid('Invalid company ID format').optional(),
});
