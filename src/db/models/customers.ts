import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  date,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { roles } from './roles';
import { vehicles } from './vehicles';
import { customerAddresses } from './customerAddresses';
import { customerContacts } from './customerContacts';
import { customerProfiles } from './customerProfiles';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    crmReferenceNo: varchar('crm_reference_no', { length: 50 }).notNull(),
    custSequenceId: varchar('cust_sequence_id', { length: 40 }).notNull(),

    customerType: varchar('customer_type', { length: 1 }).notNull(),
    title: varchar('title', { length: 20 }),
    initial: varchar('initial', { length: 10 }),
    firstName: varchar('first_name', { length: 150 }),
    lastName: varchar('last_name', { length: 150 }),

    companyName: varchar('company_name', { length: 100 }),
    tradingAs: varchar('trading_as', { length: 100 }),

    idNumber: varchar('id_number', { length: 20 }),
    passportNumber: varchar('passport_number', { length: 20 }),
    birthDate: date('birth_date'),
    gender: varchar('gender', { length: 1 }),
    maritalStatus: integer('marital_status'),
    language: varchar('language', { length: 1 }),

    citizen: boolean('citizen'),
    internalCustomer: boolean('internal_customer'),
    locked: boolean('locked'),
    activeCustomer: boolean('active_customer').notNull(),
    customerPersonal: varchar('customer_personal', { length: 1 }),

    status: integer('status'),
    financeInstitution: varchar('finance_institution', { length: 1 }),
    customerSalesType: varchar('customer_sales_type', { length: 1 }),

    primaryEmail: varchar('primary_email', { length: 100 }),
    secondaryEmail: varchar('secondary_email', { length: 100 }),
    webAddress: varchar('web_address', { length: 100 }),

    regNo: varchar('reg_no', { length: 30 }),
    taxNo: varchar('tax_no', { length: 30 }),
    ficNo: varchar('fic_no', { length: 30 }),
    currencyCode: varchar('currency_code', { length: 3 }),

    leadType: varchar('lead_type', { length: 50 }).notNull(),
    leadSource: varchar('lead_source', { length: 50 }).notNull(),
    defaultTaxCode: integer('default_tax_code'),

    fleetNo: varchar('fleet_no', { length: 30 }),
    notes: text('notes'),

    sellingDealer: varchar('selling_dealer', { length: 100 }),
    sellingDate: date('selling_date'),

    oemCustomerType: varchar('oem_customer_type', { length: 20 }),

    roleId: uuid('role_id').references(() => roles.id),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    uniqueCrmSequence: uniqueIndex('uq_customers_crm_and_sequence').on(
      t.crmReferenceNo,
      t.custSequenceId,
    ),
    activeIdx: index('idx_customers_active').on(t.activeCustomer),
  }),
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  vehicles: many(vehicles),
  addresses: many(customerAddresses),
  contacts: many(customerContacts),
  profiles: many(customerProfiles),
  role: one(roles, {
    fields: [customers.roleId],
    references: [roles.id],
  }),
}));

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
