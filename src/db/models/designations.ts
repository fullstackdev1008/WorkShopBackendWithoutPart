import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Admin-managed technician job-grade master (replaces the old fixed enum).
// name is unique case-insensitively; deactivate instead of delete (master data).
export const designations = pgTable(
  'designations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueNameCi: uniqueIndex('uq_designations_name_ci').on(sql`lower(${t.name})`),
  }),
);

export type Designation = typeof designations.$inferSelect;
export type NewDesignation = typeof designations.$inferInsert;
