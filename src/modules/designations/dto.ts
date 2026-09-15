import { z } from 'zod';

// Designation master (admin-managed technician job grade). name is required,
// trimmed, and unique case-insensitively (enforced in the service + DB index).
export const createDesignationSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(500).nullable().optional(),
});

export const updateDesignationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const designationIdParamSchema = z.object({
  id: z.string().uuid('Invalid designation ID format'),
});
