import {
  pgTable,
  uuid,
  varchar,
  boolean,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { customers } from './customers';

export const customerAr = pgTable(
  'customer_ar',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    dbArSeqId: varchar('db_ar_seq_id', { length: 40 }),
    arAccountNumber: varchar('ar_account_number', { length: 40 }),
    arAccountType: varchar('ar_account_type', { length: 10 }),
    arTypeDescrip: varchar('ar_type_descrip', { length: 100 }),

    inactiveAccount: boolean('inactive_account').default(false),
    stopCredit: boolean('stop_credit').default(false),

    // Evolve <AccountsReceivable><TermsCode> (returned as <Terms> by
    // IRM_GetARAccounts). varchar because it is a code, not a quantity — and an
    // integer could not hold a zero-padded one. Migration 0069.
    termsCode: varchar('terms_code', { length: 10 }),

    creditLimitAmount: numeric('credit_limit_amount', { precision: 14, scale: 2 }),
    creditAvailableAmount: numeric('credit_available_amount', { precision: 14, scale: 2 }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    customerIdIdx: index('idx_customer_ar_customer_id').on(t.customerId),
  }),
);

export const customerArRelations = relations(customerAr, ({ one }) => ({
  customer: one(customers, {
    fields: [customerAr.customerId],
    references: [customers.id],
  }),
}));

export type CustomerAr = typeof customerAr.$inferSelect;
export type NewCustomerAr = typeof customerAr.$inferInsert;
