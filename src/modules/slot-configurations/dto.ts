import { z } from 'zod';

export const addSlotSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  capacity: z.number().int().min(1).default(3),
});

export const updateSlotSchema = z.object({
  capacity: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const slotIdParamSchema = z.object({
  id: z.string().uuid('Invalid slot ID format'),
});
