import { z } from 'zod';

export const addComplaintSchema = z.object({
  name: z.string({ required_error: 'Complaint name is required' }).min(1).max(200),
});

export const updateComplaintSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

export const complaintIdParamSchema = z.object({
  id: z.string().uuid('Invalid complaint ID format'),
});
