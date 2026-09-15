import { z } from 'zod';

export const addServiceTypeSchema = z.object({
  code: z.string({ required_error: 'Code is required' }).min(1).max(50),
  name: z.string({ required_error: 'Name is required' }).min(1).max(100),
  emoji: z.string().max(10).default('🔧'),
});

export const updateServiceTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  emoji: z.string().max(10).optional(),
  isActive: z.boolean().optional(),
});

export const serviceTypeIdParamSchema = z.object({
  id: z.string().uuid('Invalid service type ID format'),
});
