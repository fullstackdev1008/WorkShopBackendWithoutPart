import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { customers } from './customers';

export const customerProfiles = pgTable(
  'customer_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    occupation: varchar('occupation', { length: 50 }),

    receiveEmail: boolean('receive_email'),
    receiveSms: boolean('receive_sms'),
    receivePost: boolean('receive_post'),
    receiveTelemarketing: boolean('receive_telemarketing'),

    primaryContact: varchar('primary_contact', { length: 1 }),
    secondaryContact: varchar('secondary_contact', { length: 1 }),

    receiveMarketingAll: boolean('receive_marketing_all'),
    receiveMarketingVehicle: boolean('receive_marketing_vehicle'),
    receiveMarketingService: boolean('receive_marketing_service'),
    receiveMarketingParts: boolean('receive_marketing_parts'),

    csiConsentService: boolean('csi_consent_service').default(false),
    csiConsentVehicles: boolean('csi_consent_vehicles').default(false),
    csiConsentSurveys: boolean('csi_consent_surveys').default(false),
    csiConsentBulkSms: boolean('csi_consent_bulk_sms').default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    customerIdIdx: index('idx_customer_profiles_customer_id').on(t.customerId),
  }),
);

export const customerProfilesRelations = relations(customerProfiles, ({ one }) => ({
  customer: one(customers, {
    fields: [customerProfiles.customerId],
    references: [customers.id],
  }),
}));

export type CustomerProfile = typeof customerProfiles.$inferSelect;
export type NewCustomerProfile = typeof customerProfiles.$inferInsert;
