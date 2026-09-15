import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { qcInspections } from './qcInspections';

export const qcWorkshopRework = pgTable(
  'qc_workshop_rework',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => qcInspections.id, { onDelete: 'cascade' }),
    majorComponent: varchar('major_component', { length: 200 }),
    technician: varchar('technician', { length: 200 }),
    itemNumber: varchar('item_number', { length: 100 }),
    comments: text('comments'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inspectionIdIdx: index('idx_qc_workshop_rework_inspection').on(t.inspectionId),
  }),
);
