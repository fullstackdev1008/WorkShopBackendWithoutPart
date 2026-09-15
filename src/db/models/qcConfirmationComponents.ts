import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { qcInspections } from './qcInspections';

export const qcConfirmationComponents = pgTable(
  'qc_confirmation_components',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => qcInspections.id, { onDelete: 'cascade' }),
    majorComponent: varchar('major_component', { length: 200 }),
    itemNumber: varchar('item_number', { length: 100 }),
    comment: text('comment'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inspectionIdIdx: index('idx_qc_confirm_comp_inspection').on(t.inspectionId),
  }),
);
