/**
 * Postgres session advisory lock helper (H3). Serializes a critical section
 * (e.g. the RO reconcile sweep) across multiple app instances so they can't
 * process the same job cards concurrently and create duplicate ROs.
 *
 * Lock + unlock MUST run on the same connection, so we check a dedicated client
 * out of the pool for the duration. If the lock is already held by another
 * instance, fn is skipped and the call resolves to undefined. Never throws from
 * the lock plumbing itself.
 */
import { pool } from '../../db';

export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    const locked = res.rows?.[0]?.locked === true;
    if (!locked) return undefined; // another instance holds it — skip this tick
    try {
      return await fn();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [key]);
      } catch (unlockErr) {
        console.error('[AdvisoryLock] unlock failed:', (unlockErr as Error)?.message);
      }
    }
  } finally {
    client.release();
  }
}

// Fixed lock keys for the app's background sweeps (arbitrary but stable).
export const LOCK_KEYS = {
  JOB_CARD_RECONCILE: 991_001,
  CATALOG_WARM: 991_002,
} as const;
