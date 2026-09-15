import { sql } from 'drizzle-orm';
import { db } from '../../db';

// Generates the next WT-NNNNN. Sequence-backed so it's monotonic across
// concurrent technician completions.
export async function generateTagNo(): Promise<string> {
  const result = await db.execute(sql`SELECT nextval('wt_seq') AS seq_val`);
  const seq = (result.rows[0] as any).seq_val;
  return `WT-${String(Number(seq)).padStart(5, '0')}`;
}
