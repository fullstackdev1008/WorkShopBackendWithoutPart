import { sql } from 'drizzle-orm';
import { db } from '../../db';

// INV-YYYY-NNNNN — year embedded so the human-facing number resets every
// fiscal year visually, while the sequence keeps a globally unique id.
export async function generateInvoiceNo(): Promise<string> {
  const result = await db.execute(sql`SELECT nextval('inv_seq') AS seq_val`);
  const seq = (result.rows[0] as any).seq_val;
  const year = new Date().getFullYear();
  return `INV-${year}-${String(Number(seq)).padStart(5, '0')}`;
}

// GP-NNNNN — short, scannable. No year embedded; we re-issue freely.
export async function generateGatePassCode(): Promise<string> {
  const result = await db.execute(sql`SELECT nextval('gp_seq') AS seq_val`);
  const seq = (result.rows[0] as any).seq_val;
  return `GP-${String(Number(seq)).padStart(5, '0')}`;
}
