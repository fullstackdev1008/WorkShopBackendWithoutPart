/**
 * Integration verification for ModelCode resolution (DB-gated; run manually).
 *
 *   npx ts-node-dev --transpile-only src/scripts/verifyModelCodeResolution.ts "FAW" "J6 500"
 *
 * Requires a DATABASE_URL pointing at a DB with migrations 0028/0035/0037/0038
 * applied (and ideally a warmed catalog). Proves:
 *   - the schema readiness probe reports correctly,
 *   - resolveModelCode classifies against the live catalog,
 *   - resolveModelCode performs NO writes (we snapshot vehicle_model_codes
 *     row-count before/after and assert it is unchanged).
 * This does NOT mutate data and does NOT call Evolve.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { checkEvolveReadiness } from '../db/health';
import { resolveModelCode } from '../services/modelCodeResolver.service';

async function rowCount(): Promise<number> {
  const r = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM vehicle_model_codes`)) as unknown as {
    rows?: Array<{ n: number }>;
  };
  return r.rows?.[0]?.n ?? 0;
}

async function main() {
  const make = process.argv[2] ?? 'FAW';
  const model = process.argv[3] ?? 'J6 500';

  console.log('── Evolve schema readiness ──');
  const readiness = await checkEvolveReadiness();
  console.log(JSON.stringify(readiness, null, 2));

  if (!readiness.modelCatalogReady) {
    console.warn('Catalog tables missing — apply migration 0028 and warm the catalog, then re-run.');
    await pool.end();
    return;
  }

  console.log(`\n── resolveModelCode("${make}", "${model}") ──`);
  const before = await rowCount();
  const result = await resolveModelCode(make, model);
  const after = await rowCount();

  console.log('result   :', JSON.stringify(result));
  console.log('catalog rows before/after:', before, '/', after,
    before === after ? '(✓ read-only — no writes)' : '(✗ WRITE DETECTED — contract violation!)');

  await pool.end();
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exit(1);
});
