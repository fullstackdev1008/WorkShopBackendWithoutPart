import { pgTable, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { repairCategoryEnum } from './enums';

// Many-to-many between users (with role=technician) and repair categories.
// 1:1 mapping with bay capabilities so the SA Assign modal can rank techs
// whose skills cover the item's repair category.
export const technicianSkills = pgTable(
  'technician_skills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    technicianId: uuid('technician_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skill: repairCategoryEnum('skill').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_tech_skill').on(t.technicianId, t.skill),
    techIdx: index('idx_tech_skills_tech').on(t.technicianId),
    skillIdx: index('idx_tech_skills_skill').on(t.skill),
  }),
);

export const technicianSkillsRelations = relations(technicianSkills, ({ one }) => ({
  technician: one(users, {
    fields: [technicianSkills.technicianId],
    references: [users.id],
  }),
}));

export type TechnicianSkill = typeof technicianSkills.$inferSelect;
export type NewTechnicianSkill = typeof technicianSkills.$inferInsert;
