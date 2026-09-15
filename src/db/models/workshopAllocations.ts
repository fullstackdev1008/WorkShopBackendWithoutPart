import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleCheckIns } from './vehicleCheckIns';
import { workshopBays } from './workshopBays';
import { users } from './users';
import { workshopPriorityEnum, repairCategoryEnum } from './enums';

// One row per allocation event. Append-only: re-allocation creates a new row
// with `supersededBy` pointing back. The active allocation for a check-in is
// the one whose `released_at IS NULL` — enforced by a partial unique index.
export const workshopAllocations = pgTable(
  'workshop_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    checkInId: uuid('check_in_id')
      .notNull()
      .references(() => vehicleCheckIns.id, { onDelete: 'cascade' }),
    bayId: uuid('bay_id')
      .notNull()
      .references(() => workshopBays.id),
    priority: workshopPriorityEnum('priority').notNull().default('MEDIUM'),
    repairCategory: repairCategoryEnum('repair_category').notNull().default('OTHER'),
    notes: text('notes'),
    allocatedBy: uuid('allocated_by').references(() => users.id, { onDelete: 'set null' }),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    supersededBy: uuid('superseded_by'),
  },
  (t) => ({
    checkInIdx: index('idx_allocations_check_in').on(t.checkInId),
    bayIdx: index('idx_allocations_bay').on(t.bayId),
  }),
);

export const workshopAllocationsRelations = relations(workshopAllocations, ({ one }) => ({
  checkIn: one(vehicleCheckIns, {
    fields: [workshopAllocations.checkInId],
    references: [vehicleCheckIns.id],
  }),
  bay: one(workshopBays, {
    fields: [workshopAllocations.bayId],
    references: [workshopBays.id],
  }),
  allocatedByUser: one(users, {
    fields: [workshopAllocations.allocatedBy],
    references: [users.id],
  }),
}));

export type WorkshopAllocation = typeof workshopAllocations.$inferSelect;
export type NewWorkshopAllocation = typeof workshopAllocations.$inferInsert;
