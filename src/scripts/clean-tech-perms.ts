import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';
(async () => {
  await db.execute(sql`
    DELETE FROM permissions
    WHERE role_id = (SELECT id FROM roles WHERE slug = 'technician')
  `);
  console.log('Cleared technician permissions');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
