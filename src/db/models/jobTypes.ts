import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Evolve Job Type lookup cache (RO <JobType>). Mirrors the ServiceTypes cache
 * pattern: a local, read-mostly table populated from an Evolve lookup and read
 * by the Create Job Card dropdown + RO push.
 *
 * `code` — the exact value sent in the RO `<JobType>` tag.
 * `name` — the human-readable label shown in the UI.
 *
 * TODO(AI-1 / client): this table is intentionally NOT populated yet. Population
 * is blocked on the client confirming (a) which Evolve lookup returns Job Types,
 * (b) the response XML tag names, and (c) the label→code mapping. Until the
 * Evolve lookup sync is implemented, the table stays empty and the UI shows
 * "No Job Types configured." Do NOT seed guessed codes here.
 */
export const jobTypes = pgTable(
  'job_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueCode: uniqueIndex('uq_job_types_code').on(t.code),
  }),
);

export type JobType = typeof jobTypes.$inferSelect;
export type NewJobType = typeof jobTypes.$inferInsert;
