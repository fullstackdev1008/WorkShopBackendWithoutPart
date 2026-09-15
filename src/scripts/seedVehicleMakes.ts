import { db, pool } from '../db';
import { vehicleMakes } from '../db/models';

const MAKES = [
  'Toyota',
  'Honda',
  'Ford',
  'BMW',
  'Mercedes-Benz',
  'Nissan',
  'Hyundai',
  'Kia',
  'Mazda',
  'Volkswagen',
];

async function seed() {
  console.log('Seeding vehicle makes...');
  for (const name of MAKES) {
    await db
      .insert(vehicleMakes)
      .values({ name })
      .onConflictDoUpdate({
        target: vehicleMakes.name,
        set: { updatedAt: new Date() },
      });
  }
  console.log(`Done! ${MAKES.length} vehicle makes seeded.`);
}

seed()
  .catch((err) => { console.error('Seed failed:', err); process.exit(1); })
  .finally(() => pool.end());
