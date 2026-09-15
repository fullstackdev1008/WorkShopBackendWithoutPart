import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { jobCardItems } from './jobCardItems';
import { users } from './users';
import { jciPhotoTypeEnum } from './enums';

// Per-item diagnosis + repair photo set. Same table, two photo types so we
// can query either via the type filter and still benefit from a single index.
export const jobCardItemPhotos = pgTable(
  'job_card_item_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobCardItemId: uuid('job_card_item_id')
      .notNull()
      .references(() => jobCardItems.id, { onDelete: 'cascade' }),
    photoType: jciPhotoTypeEnum('photo_type').notNull(),
    imageUrl: text('image_url').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    takenBy: uuid('taken_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    itemIdx: index('idx_jci_photos_item').on(t.jobCardItemId),
    itemTypeIdx: index('idx_jci_photos_type').on(t.jobCardItemId, t.photoType),
  }),
);

export const jobCardItemPhotosRelations = relations(jobCardItemPhotos, ({ one }) => ({
  item: one(jobCardItems, {
    fields: [jobCardItemPhotos.jobCardItemId],
    references: [jobCardItems.id],
  }),
  taker: one(users, {
    fields: [jobCardItemPhotos.takenBy],
    references: [users.id],
  }),
}));

export type JobCardItemPhoto = typeof jobCardItemPhotos.$inferSelect;
export type NewJobCardItemPhoto = typeof jobCardItemPhotos.$inferInsert;
