import { db, pool } from '../db';
import { workshopBays, workshopAllocations } from '../db/models';
import { eq } from 'drizzle-orm';

// Canonical bay set, grouped by category. Bay numbers go <category> Bay <n><A|B>.
type Category = 'SERVICE' | 'MAJOR' | 'PDI';

function buildBays(prefix: string, category: Category, count: number) {
  const out: { bayNo: string; category: Category }[] = [];
  for (let n = 1; n <= count; n++) {
    for (const side of ['A', 'B']) {
      out.push({ bayNo: `${prefix} Bay ${n}${side}`, category });
    }
  }
  return out;
}

// SERVICE 1A–10B (20), MAJOR 1A–4B (8), PDI 1A–4B (8) = 36 bays.
const BAYS = [
  ...buildBays('Service', 'SERVICE', 10),
  ...buildBays('Major', 'MAJOR', 4),
  ...buildBays('PDI', 'PDI', 4),
];

async function seed() {
  console.log(`Seeding ${BAYS.length} workshop bays (Service/Major/PDI)...`);

  const wanted = new Set(BAYS.map((b) => b.bayNo));

  // ── Remove old bays not in the canonical set ──────────────────────────────
  // Hard-delete is only possible for bays that are NOT occupied and have NEVER
  // been referenced by an allocation (FK). Anything else is deactivated so
  // historical allocations keep resolving their bay name.
  const existing = await db
    .select({ id: workshopBays.id, bayNo: workshopBays.bayNo, currentAllocationId: workshopBays.currentAllocationId })
    .from(workshopBays);

  const allocRows = await db.select({ bayId: workshopAllocations.bayId }).from(workshopAllocations);
  const referenced = new Set(allocRows.map((r) => r.bayId));

  let deleted = 0;
  let deactivated = 0;
  for (const bay of existing) {
    if (wanted.has(bay.bayNo)) continue; // keep — will be upserted below
    const locked = !!bay.currentAllocationId || referenced.has(bay.id);
    if (locked) {
      await db
        .update(workshopBays)
        .set({ isActive: false, category: null, updatedAt: new Date() })
        .where(eq(workshopBays.id, bay.id));
      deactivated++;
    } else {
      await db.delete(workshopBays).where(eq(workshopBays.id, bay.id));
      deleted++;
    }
  }

  // ── Upsert the canonical bays ─────────────────────────────────────────────
  for (const b of BAYS) {
    await db
      .insert(workshopBays)
      .values({ bayNo: b.bayNo, category: b.category, isActive: true })
      .onConflictDoUpdate({
        target: workshopBays.bayNo,
        set: { category: b.category, isActive: true, updatedAt: new Date() },
      });
  }

  console.log(
    `Done. ${BAYS.length} canonical bays upserted. Old bays: ${deleted} deleted, ${deactivated} deactivated (had history/occupied).`,
  );
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    pool.end().finally(() => process.exit(1));
  });
