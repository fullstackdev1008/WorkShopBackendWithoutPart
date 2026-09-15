import { z } from 'zod';

export const addQcChecklistTemplateSchema = z.object({
  category: z.string({ required_error: 'Category is required' }).min(1).max(50),
  subCategory: z.string().max(100).optional(),
  itemCode: z.string({ required_error: 'Item code is required' }).min(1).max(50),
  itemLabel: z.string({ required_error: 'Item label is required' }).min(1).max(200),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateQcChecklistTemplateSchema = z.object({
  category: z.string().min(1).max(50).optional(),
  subCategory: z.string().max(100).nullable().optional(),
  itemLabel: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const qcChecklistTemplateIdParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});
