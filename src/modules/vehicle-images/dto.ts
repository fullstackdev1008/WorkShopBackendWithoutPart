import { z } from 'zod';

export const vehicleImageParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID format'),
});

export const vehicleImageIdParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID format'),
  imageId: z.string().uuid('Invalid image ID format'),
});

export type VehicleImageParam = z.infer<typeof vehicleImageParamSchema>;
export type VehicleImageIdParam = z.infer<typeof vehicleImageIdParamSchema>;
