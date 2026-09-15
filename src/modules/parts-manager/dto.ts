import { z } from 'zod';

export const partIdParamSchema = z.object({
  partId: z.string().uuid('Invalid part request ID'),
});

export const markUnavailableSchema = z.object({
  expectedTime: z.string().min(1, 'Expected time is required').max(100),
});
