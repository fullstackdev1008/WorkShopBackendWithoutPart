import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { customers } from './customers';

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    addressType: varchar('address_type', { length: 20 }).notNull(),

    addressLine1: varchar('address_line1', { length: 100 }),
    addressLine2: varchar('address_line2', { length: 100 }),
    addressLine3: varchar('address_line3', { length: 100 }),
    city: varchar('city', { length: 50 }),
    provinceId: integer('province_id'),
    areaCode: varchar('area_code', { length: 10 }),
    country: varchar('country', { length: 50 }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    customerIdIdx: index('idx_customer_addresses_customer_id').on(t.customerId),
  }),
);

export const customerAddressesRelations = relations(customerAddresses, ({ one }) => ({
  customer: one(customers, {
    fields: [customerAddresses.customerId],
    references: [customers.id],
  }),
}));

export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type NewCustomerAddress = typeof customerAddresses.$inferInsert;
