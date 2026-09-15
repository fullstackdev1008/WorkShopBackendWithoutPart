import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { roles } from './roles';
import { designations } from './designations';
import { userShopScopeEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    password: varchar('password', { length: 255 }).notNull(),
    // Profile fields. fullName is a display name; avatarUrl stores the uploaded
    // image PATH/key (not a signed URL) — resolved via signUrl() on read.
    fullName: varchar('full_name', { length: 150 }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    isActive: boolean('is_active').notNull().default(true),
    isDeleted: boolean('is_deleted').notNull().default(false),
    // Record-level scoping layer (sits on top of RBAC; never replaces it).
    // Defaults preserve current behavior for every existing user:
    //   shopScope = ALL    → unrestricted across shops
    //   warrantyOnly=false → no warranty job-type restriction
    shopScope: userShopScopeEnum('shop_scope').notNull().default('ALL'),
    warrantyOnly: boolean('warranty_only').notNull().default(false),
    // Evolve DMS technician identity. Stores the TechnicianNo returned by
    // IRM_GetLookupDropdownTables (Technicians=yes); resolved at RO-sync time to
    // populate <TechNo> inside ROJobDetails. NULL for non-technicians and for
    // technicians not yet mapped by an admin. Soft reference only — Evolve is
    // external, so no FK. integer (not smallint): real TechnicianNos exceed 9999.
    evolveTechnicianNo: integer('evolve_technician_no'),
    // Evolve DMS service-advisor identity. Stores the ServiceAdvisorNumber
    // (ServiceAdvisors.SANumber) resolved at RO-sync time to populate
    // <ServiceAdvisorNumber> on IRM_ROMaintenance. NULL for non-advisors and for
    // advisors not yet mapped by an admin → RO falls back to the '1' default.
    // Soft reference only (Evolve is external, no FK). integer per artifact type.
    evolveSaNumber: integer('evolve_sa_number'),
    // Technician profile (only set for technician users; NULL otherwise).
    //   ability        informational productivity factor 0.00–1.00 (never sent to Evolve)
    //   designationId  job grade (NOT a role) → designations master (admin-managed)
    ability: numeric('ability', { precision: 3, scale: 2 }),
    designationId: uuid('designation_id').references(() => designations.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // uniqueEmail: uniqueIndex('uq_users_email').on(t.email),
    // uniqueUsername: uniqueIndex('uq_users_username').on(t.username),
    roleIdIdx: index('idx_users_role_id').on(t.roleId),
    // One Evolve technician maps to at most one local user — prevents labour
    // being posted against the same TechnicianNo from two accounts. Partial
    // (NOT NULL) so the many unmapped/non-technician rows are unconstrained.
    uqEvolveTechNo: uniqueIndex('uq_users_evolve_technician_no')
      .on(t.evolveTechnicianNo)
      .where(sql`${t.evolveTechnicianNo} IS NOT NULL`),
    // One Evolve service advisor maps to at most one local user. Partial
    // (NOT NULL) so unmapped/non-advisor rows are unconstrained.
    uqEvolveSaNo: uniqueIndex('uq_users_evolve_sa_number')
      .on(t.evolveSaNumber)
      .where(sql`${t.evolveSaNumber} IS NOT NULL`),
  }),
);

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
  designation: one(designations, {
    fields: [users.designationId],
    references: [designations.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
