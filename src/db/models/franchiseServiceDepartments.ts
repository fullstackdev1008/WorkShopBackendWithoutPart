import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

/**
 * Evolve FranchiseServiceDepartments lookup cache (AI-3). Mirrors the
 * ServiceTypes cache pattern.
 *
 * Source of truth: IRM_GetLookupDropdownTables, table `FranchiseServiceDepartments`.
 * The live production response (confirmed against 20EC) carries both numbers and
 * names per row, all captured here:
 *   • `franchise_seq_id`    ← FranchiseServiceDepartments.FranchiseSeqID (→ RO <FranchiseSeqID>)
 *   • `sd_number`           ← FranchiseServiceDepartments.SDNumber       (→ RO <ServiceDept>)
 *   • `franchise_label`     ← FranchiseServiceDepartments.Franshise [sic] (UI Franchise dropdown)
 *   • `service_dept_label`  ← FranchiseServiceDepartments.SDName          (UI Service Dept dropdown)
 *
 * The labels are populated by master-data sync (see mapFranchiseServiceDepartmentRow)
 * and are what the job-card Franchise / Service-Dept dropdowns display; the numbers
 * are what the selected pair sends to Evolve. Nothing here is invented — every
 * value comes from Evolve's lookup response.
 */
export const franchiseServiceDepartments = pgTable(
  'franchise_service_departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Company (dealership) this pair belongs to. Evolve answers
    // IRM_GetLookupDropdownTables per InterfaceCode, so the pairs are
    // per-company — 10EC and 20EC can return different franchises, and even the
    // same (FranchiseSeqID, SDNumber) with different names.
    //
    // NULL = unscoped: rows cached before this column existed, when a single
    // env InterfaceCode drove the sync. They are never back-filled to a guessed
    // company; listFsd shows them to every company so the dropdown keeps
    // working until a per-company sync supersedes them.
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    franchiseSeqId: varchar('franchise_seq_id', { length: 20 }).notNull(),
    sdNumber: varchar('sd_number', { length: 20 }).notNull(),
    // Human labels the admin assigns after master-data sync ("sync then label").
    // franchiseLabel groups the Franchise dropdown (e.g. "FAW"); serviceDeptLabel
    // is the Service Dept option within it (e.g. "Service - FAW"). NULL until an
    // admin labels the pair — unlabeled pairs are hidden from the FE dropdowns.
    franchiseLabel: varchar('franchise_label', { length: 100 }),
    serviceDeptLabel: varchar('service_dept_label', { length: 100 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // A franchise may have multiple service departments, and the same pair may
    // exist in both companies → the key is (company, franchise, service dept).
    // The partial unique index covering the NULL-company legacy rows is defined
    // in SQL (drizzle/0070) — Drizzle cannot express a partial unique index here.
    uniqueCompanyFranchiseSd: uniqueIndex(
      'uq_franchise_service_departments_company_seq_sd',
    ).on(t.companyId, t.franchiseSeqId, t.sdNumber),
    companyIdIdx: index('idx_franchise_service_departments_company_id').on(t.companyId),
  }),
);

export type FranchiseServiceDepartment = typeof franchiseServiceDepartments.$inferSelect;
export type NewFranchiseServiceDepartment = typeof franchiseServiceDepartments.$inferInsert;
