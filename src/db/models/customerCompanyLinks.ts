import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { customers } from './customers';
import { companies } from './companies';

/**
 * Links a customer to a company (dealership). A customer may exist in multiple
 * companies, each with its own Evolve CustSequenceID — hence a join table rather
 * than a single column on `customers`.
 *
 * Written idempotently at appointment creation (ON CONFLICT DO NOTHING).
 * `cust_sequence_id` / `crm_reference_no` are filled per company by Phase C
 * (customer sync); nullable until then.
 *
 * FK semantics (ADR-001 Appendix B): customer_id CASCADE (a link is meaningless
 * without its customer); company_id RESTRICT (companies are deactivated, not
 * deleted, so links are never silently dropped).
 */
export const customerCompanyLinks = pgTable(
  'customer_company_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    custSequenceId: varchar('cust_sequence_id', { length: 50 }),
    crmReferenceNo: varchar('crm_reference_no', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCustomerCompany: uniqueIndex('uq_customer_company_links_customer_company').on(
      t.customerId,
      t.companyId,
    ),
    companyIdIdx: index('idx_customer_company_links_company_id').on(t.companyId),
  }),
);

export const customerCompanyLinksRelations = relations(customerCompanyLinks, ({ one }) => ({
  customer: one(customers, {
    fields: [customerCompanyLinks.customerId],
    references: [customers.id],
  }),
  company: one(companies, {
    fields: [customerCompanyLinks.companyId],
    references: [companies.id],
  }),
}));

export type CustomerCompanyLink = typeof customerCompanyLinks.$inferSelect;
export type NewCustomerCompanyLink = typeof customerCompanyLinks.$inferInsert;
