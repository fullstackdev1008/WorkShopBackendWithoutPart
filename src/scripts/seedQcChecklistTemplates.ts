import { db, pool } from '../db';
import { qcChecklistTemplates } from '../db/models';
import { QC_CHECKLIST_ITEMS } from '../constants/qcChecklistItems';

async function seed() {
  console.log(`Seeding ${QC_CHECKLIST_ITEMS.length} QC checklist templates...`);

  for (const item of QC_CHECKLIST_ITEMS) {
    await db
      .insert(qcChecklistTemplates)
      .values({
        category: item.category,
        itemCode: item.itemCode,
        itemLabel: item.itemLabel,
        sortOrder: item.sortOrder,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: qcChecklistTemplates.itemCode,
        set: {
          category: item.category,
          itemLabel: item.itemLabel,
          sortOrder: item.sortOrder,
          isActive: true,
          updatedAt: new Date(),
        },
      });
  }

  console.log('Done.');
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
