import 'dotenv/config';
import path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '../config/env';

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);

  const migrationsFolder = path.resolve(__dirname, '../drizzle');
  console.log(`Applying migrations from: ${migrationsFolder}`);

  await migrate(db, { migrationsFolder });

  console.log('Migrations applied successfully');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
