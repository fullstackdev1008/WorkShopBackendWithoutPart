import { z } from 'zod';
import { passwordStrength } from '../auth/dto';

// ─── Roles ───────────────────────────────────────────────────────────────────
export const createRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required').max(100),
  slug: z
    .string()
    .min(1, 'Role slug is required')
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only')
    .optional(),
  isActive: z.boolean().optional(),
});

export const roleIdParamSchema = z.object({
  roleId: z.string().uuid('Invalid role ID'),
});

// ─── Users ───────────────────────────────────────────────────────────────────

const usernameField = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(100)
  .regex(/^[a-z0-9_]+$/, 'Username may only contain lowercase letters, digits, and underscores — no spaces or special characters');

export const createUserSchema = z.object({
  username: usernameField,
  email: z.string().email('Invalid email address').max(255),
  password: passwordStrength.max(255),
  fullName: z.string().trim().max(150).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  roleSlug: z.string().min(1, 'Role is required'),
  // Record-level scoping (optional; server applies defaults ALL / false).
  shopScope: z.enum(['SERVICE', 'MAJOR', 'ALL']).optional(),
  warrantyOnly: z.boolean().optional(),
  // Evolve technician mapping — only meaningful when roleSlug === 'technician'.
  evolveTechnicianNo: z.number().int().positive().nullable().optional(),
  // Evolve service-advisor mapping — only meaningful when roleSlug === 'service-advisor'.
  evolveSaNumber: z.number().int().positive().nullable().optional(),
  // Technician profile (optional; only meaningful for technician users).
  ability: z.number().min(0).max(1).nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
});

export const updateUserSchema = z.object({
  username: usernameField.optional(),
  email: z.string().email('Invalid email address').max(255).optional(),
  // Optional on edit; when provided it must meet the strength rules. Empty is
  // coerced to "keep current" by the frontend (omitted from the payload).
  password: passwordStrength.max(255).optional(),
  fullName: z.string().trim().max(150).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  roleSlug: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  // Record-level scoping (optional).
  shopScope: z.enum(['SERVICE', 'MAJOR', 'ALL']).optional(),
  warrantyOnly: z.boolean().optional(),
  // Evolve technician mapping — set when technician, cleared when role changes away.
  evolveTechnicianNo: z.number().int().positive().nullable().optional(),
  // Evolve service-advisor mapping — set when service-advisor, cleared otherwise.
  evolveSaNumber: z.number().int().positive().nullable().optional(),
  // Technician profile — set when technician, cleared when role changes away.
  ability: z.number().min(0).max(1).nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
});

export const userIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

// ─── Evolve technician mapping ─────────────────────────────────────────────────
// Sets (or clears) the Evolve TechnicianNo on a local technician user. null
// clears the mapping; a positive integer must correspond to an ACTIVE Evolve
// technician (validated against IRM_GetLookupDropdownTables at save time).
export const setEvolveTechnicianNoSchema = z.object({
  evolveTechnicianNo: z
    .number({ invalid_type_error: 'evolveTechnicianNo must be a number or null' })
    .int('evolveTechnicianNo must be an integer')
    .positive('evolveTechnicianNo must be positive')
    .nullable(),
});

// ─── Evolve service-advisor mapping ────────────────────────────────────────────
// Sets (or clears) the Evolve SANumber on a local service-advisor user. null
// clears the mapping; a positive integer must correspond to an ACTIVE Evolve
// service advisor (validated against IRM_GetLookupDropdownTables at save time).
export const setEvolveSaNumberSchema = z.object({
  evolveSaNumber: z
    .number({ invalid_type_error: 'evolveSaNumber must be a number or null' })
    .int('evolveSaNumber must be an integer')
    .positive('evolveSaNumber must be positive')
    .nullable(),
});
