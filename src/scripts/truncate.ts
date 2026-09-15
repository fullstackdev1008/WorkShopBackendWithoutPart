import { sql } from 'drizzle-orm';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { db, pool } from '../db';
import { s3, S3_BUCKET } from '../middleware/s3';

const STORAGE_PREFIX = 'uploads/';

// ─── Tables to KEEP ──────────────────────────────────────────────────────────
// These contain mandatory seed / reference data and must NOT be touched.
const PROTECTED_TABLES = [
  // Auth seed (seed.ts)
  'roles',
  'users',
  'permissions',
  // Vehicle reference (required by seedServiceAssignments.ts)
  'vehicle_makes',
  'vehicle_models',
  // Service catalogue seed (seed.ts / addPaidService.ts / activateBCDCategory.ts)
  'service_types',
  // Parts & model-service assignments (seedParts.ts / seedServiceAssignments.ts)
  'parts_master',
  'model_service_type_assignments',
  // QC checklist template (inspection items master)
  'qc_checklist_templates',
  // QC-out checklist master (sign-out items master, seeded via migration 0017)
  'qc_out_checklist',
  // Workshop bays master (physical bay list, seeded via migration 0014)
  'workshop_bays',
  // Appointment reference data
  'slot_configurations',
  'complaints',
  // Other lookup / reference tables
  'vehicle_conditions',
  'vehicle_colours',
  'provinces',
  'ro_statuses',
  'service_advisors',
];

// ─── Drizzle's migration-tracking table — never truncate ─────────────────────
// Drizzle keeps applied migration history here; wiping it would force a full
// re-migrate on next deploy.
const SYSTEM_TABLES = [
  '__drizzle_migrations',
];

async function truncateStorage() {
  console.log(`Truncating Supabase storage objects under "${STORAGE_PREFIX}":`);

  if (!S3_BUCKET) {
    console.log('  ⚠ S3_BUCKET is not configured — skipping storage truncation.');
    return;
  }

  let continuationToken: string | undefined;
  let totalDeleted = 0;

  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: STORAGE_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = listed.Contents ?? [];
    if (objects.length > 0) {
      // DeleteObjects accepts up to 1000 keys per call, which matches
      // ListObjectsV2's default page size — one delete per page.
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: {
            Objects: objects.map((o) => ({ Key: o.Key! })),
            Quiet: true,
          },
        }),
      );
      totalDeleted += objects.length;
      const errors = result.Errors ?? [];
      for (const e of errors) {
        console.error(`  ✗ Delete error: ${e.Key} — ${e.Message}`);
      }
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`  ✗ Deleted ${totalDeleted} object(s) from "${S3_BUCKET}/${STORAGE_PREFIX}"`);
}

async function truncateTables() {
  console.log('Starting table truncation...\n');

  console.log('Protected tables (will NOT be truncated):');
  PROTECTED_TABLES.forEach((t) => console.log(`  ✓ ${t}`));
  console.log('');

  // workshop_bays has an undocumented FK chain that pulls it into the cascade
  // even though it's protected:
  //
  //   TRUNCATE vehicle_check_ins CASCADE
  //     → workshop_allocations (check_in_id → vehicle_check_ins.id)
  //       → workshop_bays      (current_allocation_id → workshop_allocations.id)
  //
  // PostgreSQL's CASCADE follows the FK topology regardless of row counts, so
  // emptying the tables first doesn't help. The only way to keep workshop_bays
  // intact is to break the FK temporarily, then restore it after the truncate.
  console.log('Clearing workshop_allocations and dropping FK chain (preserves workshop_bays)...');
  await db.execute(sql.raw(`UPDATE workshop_bays SET current_allocation_id = NULL`));
  await db.execute(sql.raw(`DELETE FROM workshop_allocations`));
  await db.execute(sql.raw(`ALTER TABLE workshop_bays DROP CONSTRAINT IF EXISTS fk_bay_current_allocation`));

  // Discover every user table in the public schema, then subtract the
  // protected + system lists. This way any new table (gate_passes,
  // warranty_parts, invoices, qc_out_*, etc.) is wiped automatically
  // without needing to update this script.
  const skip = new Set<string>([...PROTECTED_TABLES, ...SYSTEM_TABLES, 'workshop_allocations']);
  const allRows = await db.execute(
    sql.raw(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`),
  );
  const tablesToTruncate = (allRows.rows as Array<{ tablename: string }>)
    .map((r) => r.tablename)
    .filter((t) => !skip.has(t))
    .sort();

  if (tablesToTruncate.length === 0) {
    console.log('No transactional tables found.');
  } else {
    console.log(`Truncating ${tablesToTruncate.length} transactional table(s):`);
    // One combined TRUNCATE … CASCADE call resolves FK chains across all
    // tables at once and avoids partial-state issues mid-loop.
    const tableList = tablesToTruncate.map((t) => `"${t}"`).join(', ');
    try {
      await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
      tablesToTruncate.forEach((t) => console.log(`  ✓ Truncated: ${t}`));
    } catch (err: any) {
      console.error(`  ✗ Bulk truncate failed: ${err.message}`);
      console.error('  Falling back to per-table truncate...');
      for (const table of tablesToTruncate) {
        try {
          await db.execute(sql.raw(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`));
          console.log(`  ✓ Truncated: ${table}`);
        } catch (e: any) {
          console.error(`  ✗ Failed to truncate ${table}: ${e.message}`);
        }
      }
    }
  }

  // Restore the FK we dropped earlier so the schema is back to its normal
  // state before any subsequent inserts hit workshop_bays.
  try {
    await db.execute(sql.raw(`
      ALTER TABLE workshop_bays
        ADD CONSTRAINT fk_bay_current_allocation
        FOREIGN KEY (current_allocation_id)
        REFERENCES workshop_allocations(id)
        ON DELETE SET NULL
    `));
    console.log('Restored FK fk_bay_current_allocation on workshop_bays.');
  } catch (err: any) {
    console.error(`  ✗ Could not restore fk_bay_current_allocation: ${err.message}`);
  }

  console.log('');
  try {
    await truncateStorage();
  } catch (err: any) {
    console.error(`  ✗ Storage truncation failed: ${err.message}`);
  }

  console.log('\n─── Truncation completed! ───');
  console.log('\nSeed data preserved:');
  console.log('  roles, users, permissions');
  console.log('  service_types, parts_master, model_service_type_assignments');
  console.log('  vehicle_makes, vehicle_models, qc_checklist_templates');
  console.log('  qc_out_checklist, workshop_bays');
  console.log('  slot_configurations, complaints, and other lookup tables');
}

truncateTables()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Truncation failed:', err);
    pool.end();
    process.exit(1);
  });
