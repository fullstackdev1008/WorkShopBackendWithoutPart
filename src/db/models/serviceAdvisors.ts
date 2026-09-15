import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const serviceAdvisors = pgTable(
  'service_advisors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    advisorCode: varchar('advisor_code', { length: 50 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueAdvisorCode: uniqueIndex('uq_service_advisors_code').on(t.advisorCode),
  }),
);

export type ServiceAdvisor = typeof serviceAdvisors.$inferSelect;
export type NewServiceAdvisor = typeof serviceAdvisors.$inferInsert;
