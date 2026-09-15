import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './models';
import { env } from '../config/env';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  // Opening a connection to a serverless Postgres (Neon) that has scaled to
  // zero takes seconds, not milliseconds — measured at 3.5-4.5s here, and
  // longer on a fully cold branch. The previous 2000ms was tuned for a local /
  // same-region instance: once the pool's idle connections expired, EVERY new
  // connection blew the limit and the whole API returned
  // "Connection terminated due to connection timeout" while /health (which
  // never touches the DB) kept reporting the server as fine.
  // This is the ceiling before giving up, not added latency on a warm pool.
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

export const db = drizzle(pool, { schema });
export { pool };

export async function checkDatabaseConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('Database connection established successfully');
  } finally {
    client.release();
  }
}
