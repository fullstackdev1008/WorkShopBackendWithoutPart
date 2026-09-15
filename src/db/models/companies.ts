import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Dealership / company registry. Single source of truth for the company
 * selector: drives the FE dropdown, the backend interface-code allowlist, and
 * the Evolve `InterfaceCode` used for company-scoped lookups. Also the FK target
 * for a vehicle's owning company (see vehicles.owning_company_id).
 *
 * `code`           — short label shown in the UI (e.g. '10EC', '20EC').
 * `interface_code` — the Evolve InterfaceCode sent for this company
 *                    (e.g. '95112-AGLT-10EC'). Unique per company.
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    interfaceCode: varchar('interface_code', { length: 50 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCode: uniqueIndex('uq_companies_code').on(t.code),
    uniqueInterfaceCode: uniqueIndex('uq_companies_interface_code').on(t.interfaceCode),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
