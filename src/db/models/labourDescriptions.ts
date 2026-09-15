import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Admin-managed Labour Master (Phase 3). Feeds the Job Card Labour-section
// dropdown, ordered newest-first (LIFO). name is unique case-insensitively;
// deactivate instead of delete (master data). Mirrors the designations master.
export const labourDescriptions = pgTable(
  'labour_descriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueNameCi: uniqueIndex('uq_labour_descriptions_name_ci').on(sql`lower(${t.name})`),
  }),
);

export type LabourDescription = typeof labourDescriptions.$inferSelect;
export type NewLabourDescription = typeof labourDescriptions.$inferInsert;
