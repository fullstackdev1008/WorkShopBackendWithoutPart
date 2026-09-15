import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { vehicleCheckIns } from './vehicleCheckIns';
import { users } from './users';

// One row per RO-status transition. Append-only — never updated.
// setRoStatus() is the sole writer; it bumps vehicle_check_ins.ro_status AND
// inserts here in the same transaction so the audit trail can never drift.
export const roStatusHistory = pgTable(
  'ro_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    checkInId: uuid('check_in_id')
      .notNull()
      .references(() => vehicleCheckIns.id, { onDelete: 'cascade' }),
    fromStatus: varchar('from_status', { length: 40 }),
    toStatus: varchar('to_status', { length: 40 }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
  },
  (t) => ({
    checkInIdx: index('idx_ro_status_history_check_in_id').on(t.checkInId),
    atIdx: index('idx_ro_status_history_at').on(t.at),
  }),
);

export const roStatusHistoryRelations = relations(roStatusHistory, ({ one }) => ({
  checkIn: one(vehicleCheckIns, {
    fields: [roStatusHistory.checkInId],
    references: [vehicleCheckIns.id],
  }),
  byUser: one(users, {
    fields: [roStatusHistory.byUserId],
    references: [users.id],
  }),
}));

export type RoStatusHistory = typeof roStatusHistory.$inferSelect;
export type NewRoStatusHistory = typeof roStatusHistory.$inferInsert;
