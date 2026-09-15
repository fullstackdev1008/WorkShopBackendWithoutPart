import { z } from 'zod';

const optNumeric = () =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, 'Must be a numeric value')
    .nullish();

export const addAccessorySchema = z.object({
  accessoryCode: z
    .string({ required_error: 'Accessory code is required' })
    .min(1)
    .max(100),
  accessoryName: z
    .string({ required_error: 'Accessory name is required' })
    .min(1)
    .max(200),
  accessoryType: z.string().max(50).nullish(),
  quantity: z.number().int().min(1).default(1),
  unitPrice: optNumeric(),
  totalPrice: optNumeric(),
  isFactoryFitted: z.boolean().default(true),
});

export const updateAccessorySchema = z
  .object({
    accessoryName: z.string().min(1).max(200).optional(),
    accessoryType: z.string().max(50).nullish(),
    quantity: z.number().int().min(1).optional(),
    unitPrice: optNumeric(),
    totalPrice: optNumeric(),
    isFactoryFitted: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided to update',
  });

export const accessoryParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID format'),
});

export const accessoryIdParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID format'),
  id: z.string().uuid('Invalid accessory ID format'),
});

export type AddAccessoryInput = z.infer<typeof addAccessorySchema>;
export type UpdateAccessoryInput = z.infer<typeof updateAccessorySchema>;
