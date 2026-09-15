/**
 * OPTIONAL Job Type seed — run MANUALLY, only AFTER client confirmation.
 *
 *   npx ts-node-dev --transpile-only src/scripts/seedJobTypes.ts --confirm
 *   (or set SEED_JOB_TYPES_CONFIRM=true)
 *
 * Without the explicit --confirm flag / env var it does NOTHING except print
 * these instructions — so it can never silently seed guessed data.
 *
 * The codes below are the ones documented in the Evolve artifacts
 * (apitest 14b: JobType {CSH,CST,ESC,INT,VEH,WAR}) mapped to the four labels the
 * client requested (Cash / CST / ESC / Warranty). They are NOT invented, but the
 * client must still confirm the CSH=Cash / WAR=Warranty label mapping before
 * this is run. INT (Internal) and VEH (Vehicle) are intentionally NOT seeded —
 * INT must only ever be sent when explicitly selected.
 *
 * Idempotent: existing codes are left untouched (onConflictDoNothing on `code`).
 */
import 'dotenv/config';
import { db, pool } from '../db';
import { jobTypes } from '../db/models';

// Client-requested set (Action Item 1). Confirm CSH=Cash / WAR=Warranty first.
const JOB_TYPES: Array<{ code: string; name: string }> = [
  { code: 'CSH', name: 'Cash' },
  { code: 'CST', name: 'CST' },
  { code: 'ESC', name: 'ESC' },
  { code: 'WAR', name: 'Warranty' },
];

async function main() {
  const confirmed = process.argv.includes('--confirm') || process.env.SEED_JOB_TYPES_CONFIRM === 'true';
  if (!confirmed) {
    console.log(
      'Job Type seed NOT run — confirmation required.\n' +
        'This inserts CSH/CST/ESC/WAR (client Action Item 1). Only run after the\n' +
        'client confirms the codes + labels. Re-run with:\n' +
        '  npx ts-node-dev --transpile-only src/scripts/seedJobTypes.ts --confirm\n' +
        '  (or SEED_JOB_TYPES_CONFIRM=true)',
    );
    await pool.end();
    return;
  }

  console.log(`Seeding ${JOB_TYPES.length} job types (confirmed): ${JOB_TYPES.map((j) => j.code).join(', ')}`);
  const inserted = await db
    .insert(jobTypes)
    .values(JOB_TYPES.map((j) => ({ code: j.code, name: j.name })))
    .onConflictDoNothing({ target: jobTypes.code })
    .returning({ code: jobTypes.code });

  console.log(
    inserted.length
      ? `Inserted: ${inserted.map((r) => r.code).join(', ')}`
      : 'No new job types inserted (all codes already present).',
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error('seedJobTypes failed:', err);
  await pool.end();
  process.exit(1);
});
