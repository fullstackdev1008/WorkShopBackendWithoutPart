import { z } from 'zod';

// Labour Master (admin-managed). name is required, trimmed, and unique
// case-insensitively (enforced in the service + DB index). The dropdown orders
// newest-first (LIFO), so there is no display-order field. Mirrors designations.
export const createLabourDescriptionSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(100),
});

export const updateLabourDescriptionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  isActive: z.boolean().optional(),
});

export const labourDescriptionIdParamSchema = z.object({
  id: z.string().uuid('Invalid labour description ID format'),
});
