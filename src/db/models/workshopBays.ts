import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { bayCategoryEnum } from './enums';

// Master of physical bays in the workshop. Managed via a small CRUD under
// Settings → Workshop Bays. Each bay has a list of `capabilities` (string
// tags) used to filter the dropdown when the foreman picks a bay.
export const workshopBays = pgTable('workshop_bays', {
  id: uuid('id').defaultRandom().primaryKey(),
  bayNo: varchar('bay_no', { length: 20 }).notNull().unique(),
  // Category groups bays (SERVICE / MAJOR / PDI) so allocation can filter by
  // type. Nullable: legacy/uncategorised bays predate this column.
  category: bayCategoryEnum('category'),
  location: varchar('location', { length: 100 }),
  // text[] — drizzle doesn't have a native array helper, so we use a custom
  // column type via sql. For type safety we declare it as a notes-style text
  // column and let the service layer (de)serialise. The migration creates
  // the column with `text[]`, so reads/writes go through node-postgres'
  // array adapter — no manual parsing needed at runtime.
  capabilities: text('capabilities').array(),
  isActive: boolean('is_active').notNull().default(true),
  currentAllocationId: uuid('current_allocation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workshopBaysRelations = relations(workshopBays, () => ({}));

export type WorkshopBay = typeof workshopBays.$inferSelect;
export type NewWorkshopBay = typeof workshopBays.$inferInsert;
