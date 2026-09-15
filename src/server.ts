import { count, and, eq, isNotNull } from 'drizzle-orm';
import { buildApp } from './app';
import { checkDatabaseConnection, db } from './db';
import { vehicleMakes, jobTypes, franchiseServiceDepartments } from './db/models';
import { env } from './config/env';
import { syncAllMasterData } from './services/masterDataSync.service';

// ─── Start Server ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await checkDatabaseConnection();

    const app = await buildApp();

    await app.listen({ port: env.PORT, host: '0.0.0.0' }, () => {
      console.log(`Server is listening on port ${env.PORT}`);
    });

    console.log(`Server running → http://${env.HOST}:${env.PORT}`);
    console.log(`Environment   → ${env.NODE_ENV}`);

    // ── Master Data Sync (background — does not block server startup) ─────────
    // Self-healing: only runs when the makes table is empty (e.g. first boot,
    // or after the make/model tables are cleared) — so a normal restart with
    // data already present stays quiet and doesn't replay one
    // IRM_GetSeriesData call per make. Force a re-sync any time with
    // SYNC_ON_STARTUP=true, or on demand via POST /api/sync/master-data.
    (async () => {
      try {
        const [{ makeCount }] = await db.select({ makeCount: count() }).from(vehicleMakes);
        if (env.SYNC_ON_STARTUP || Number(makeCount) === 0) {
          console.log(
            `Running startup master-data sync (${env.SYNC_ON_STARTUP ? 'forced via SYNC_ON_STARTUP' : 'makes table empty'})...`,
          );
          const result = await syncAllMasterData();
          console.log('Master data sync completed:', JSON.stringify(result));
        } else {
          console.log(
            `Startup master-data sync skipped (${makeCount} makes present). Use POST /api/sync/master-data to re-sync.`,
          );
        }
      } catch (err) {
        console.error('Master data sync failed:', err);
      }
    })();

    // ── Configuration warnings (AI-1 / AI-3) — non-blocking ──────────────────
    // These lookups are client-configured. When empty, the integration falls
    // back to defaults (RO <JobType>=INT, <FranchiseSeqID>/<ServiceDept>='1'),
    // so surface a warning at boot. WARN only — never blocks startup, and any
    // error (e.g. table not yet migrated) is caught and logged, not thrown.
    (async () => {
      try {
        const [{ n: jobTypeCount }] = await db.select({ n: count() }).from(jobTypes);
        if (Number(jobTypeCount) === 0) {
          console.warn(
            '[config] WARNING: job_types is EMPTY — Create Job Card shows "No Job Types configured" ' +
              'and every RO falls back to <JobType>INT</JobType>. Configure via POST /api/job-types ' +
              '(or the optional src/scripts/seedJobTypes.ts, after client confirmation).',
          );
        }
      } catch (err) {
        console.warn('[config] job_types check skipped:', (err as Error)?.message);
      }
      try {
        const [{ n: labeledPairs }] = await db
          .select({ n: count() })
          .from(franchiseServiceDepartments)
          .where(
            and(
              eq(franchiseServiceDepartments.isActive, true),
              isNotNull(franchiseServiceDepartments.franchiseLabel),
              isNotNull(franchiseServiceDepartments.serviceDeptLabel),
            ),
          );
        if (Number(labeledPairs) === 0) {
          console.warn(
            '[config] WARNING: no labeled Franchise/Service-Dept pairs — the job-card dropdowns will be ' +
              "empty and RO franchise falls back to <FranchiseSeqID>1</FranchiseSeqID>/<ServiceDept>1</ServiceDept>. " +
              'Run POST /api/sync/master-data to fetch the (FranchiseSeqID, SDNumber) pairs, then label them via ' +
              'PUT /api/franchise-service-depts/:id.',
          );
        }
      } catch (err) {
        console.warn('[config] franchise_service_departments check skipped:', (err as Error)?.message);
      }
    })();

    // // Keep Render instance alive by pinging health endpoint every 14 minutes
    // setInterval(async () => {
    //   try {
    //     const res = await fetch('https://workshopbackend-fjvw.onrender.com/api/health');
    //   } catch (err) {
    //     console.error('Health ping failed:', err);
    //   }
    // }, 1500);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
