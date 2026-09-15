import { z } from 'zod';

// Shared password-strength rule (>= 8 chars, one upper, one lower, one number).
// Reused by profile update and user-management create/update.
export const passwordStrength = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number');

// My Profile update. username/email required (form is prefilled); fullName
// optional; password optional — empty/omitted means "keep current".
export const updateProfileSchema = z.object({
  fullName: z.string().trim().max(150).nullish(),
  username: z
    .string({ required_error: 'Username is required' })
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-z0-9_]+$/, 'Username may only contain lowercase letters, digits, and underscores'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255),
  password: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    passwordStrength.optional(),
  ),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email format'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

export const registerSchema = z.object({
  username: z
    .string({ required_error: 'Username is required' })
    .min(3, 'Username must be at least 3 characters')
    .max(100),
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email format'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(6, 'Password must be at least 6 characters'),
  roleSlug: z
    .string({ required_error: 'Role is required' })
    .min(1, 'Role is required'),
});
