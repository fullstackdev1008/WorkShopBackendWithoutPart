import { z } from 'zod';

const PHOTO_TYPES = [
  'FRONT',
  'REAR',
  'LEFT',
  'RIGHT',
  'DASHBOARD',
  'ENGINE',
  'OTHER',
] as const;

const CHECK_IN_STATUSES = [
  'IN_QUEUE',
  'IN_SERVICE',
  'READY',
  'COMPLETED',
  'CANCELLED',
] as const;

// ─── Create Check-In ─────────────────────────────────────────────────────────
export const createCheckInSchema = z.object({
  vehicleId: z.string({ required_error: 'Vehicle ID is required' }).uuid(),
  checkInNumber: z.string().max(50).nullish(),
  odometerReading: z
    .number({ required_error: 'Odometer reading is required' })
    .int()
    .min(0),
  notes: z.string().nullish(),
  // Record-level shop marker (SERVICE / MAJOR / PDI). Optional/nullable.
  shop: z.enum(['SERVICE', 'MAJOR', 'PDI']).nullish(),
});

// ─── Update Check-In ─────────────────────────────────────────────────────────
export const updateCheckInSchema = z
  .object({
    checkInNumber: z.string().max(50).nullish(),
    odometerReading: z.number().int().min(0).optional(),
    status: z.enum(CHECK_IN_STATUSES).optional(),
    notes: z.string().nullish(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided to update',
  });

// ─── Insert Photo ────────────────────────────────────────────────────────────
export const insertPhotoSchema = z.object({
  photoType: z.enum(PHOTO_TYPES, {
    required_error: 'Photo type is required',
    invalid_type_error: `Photo type must be one of: ${PHOTO_TYPES.join(', ')}`,
  }),
});

// ─── Param Schemas ──────────────────────────────────────────────────────────
export const checkInIdParamSchema = z.object({
  id: z.string().uuid('Invalid check-in ID format'),
});

export const checkInPhotoParamSchema = z.object({
  checkInId: z.string().uuid('Invalid check-in ID format'),
});

export const checkInPhotoIdParamSchema = z.object({
  checkInId: z.string().uuid('Invalid check-in ID format'),
  photoId: z.string().uuid('Invalid photo ID format'),
});

export const checkInListQuerySchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID format').optional(),
  status: z.enum(CHECK_IN_STATUSES).optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────
export type CreateCheckInInput = z.infer<typeof createCheckInSchema>;
export type UpdateCheckInInput = z.infer<typeof updateCheckInSchema>;
export type InsertPhotoInput = z.infer<typeof insertPhotoSchema>;
