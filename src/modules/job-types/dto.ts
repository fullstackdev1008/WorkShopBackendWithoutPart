import { z } from 'zod';

// Job Type master (admin-managed). `code` is the exact value sent in the RO
// <JobType> tag; `name` is the UI label. Uniqueness on code is enforced
// case-insensitively in the service + by the uq_job_types_code index. No codes
// are seeded/guessed — the admin (or the optional seed script, post client
// confirmation) supplies them.
export const createJobTypeSchema = z.object({
  code: z.string({ required_error: 'Code is required' }).trim().min(1, 'Code is required').max(50),
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(100),
  isActive: z.boolean().optional(),
});

export const updateJobTypeSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(50).optional(),
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  isActive: z.boolean().optional(),
});

export const jobTypeIdParamSchema = z.object({
  id: z.string().uuid('Invalid job type ID format'),
});

export const listJobTypeQuerySchema = z.object({
  // 'all' → include inactive (admin management view). Default/omitted → active
  // only (the Create Job Card dropdown), preserving existing behaviour.
  status: z.enum(['all', 'active']).optional(),
});
