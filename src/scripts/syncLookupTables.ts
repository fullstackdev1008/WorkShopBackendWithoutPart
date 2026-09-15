/**
 * Fast lookup-table sync — run on the SERVER via node, NOT over HTTP.
 *
 *   node dist/scripts/syncLookupTables.js
 *   (or: npm run sync:lookups)
 *
 * Runs ONLY the single IRM_GetLookupDropdownTables call + DB upserts for the
 * lookup tables (FranchiseServiceDepartments, ServiceTypes, ROStatuses,
 * ServiceAdvisors, Provinces, Conditions, Colours). It deliberately SKIPS the
 * heavy makes → series → model-code loop that makes POST /api/sync/master-data
 * exceed the nginx timeout (504). Franchises don't need that loop.
 *
 * Requires the deployed build that captures Evolve's Franshise / SDName labels,
 * so the franchise_service_departments rows come back fully labeled.
 */
import 'dotenv/config';
import { pool } from '../db';
import { fetchLookupTables, syncOtherTables } from '../services/masterDataSync.service';

async function main() {
  console.log('Fetching Evolve lookup tables (single IRM_GetLookupDropdownTables call)...');
  const lookup = await fetchLookupTables({
    Provinces: true,
    VehicleConditions: true,
    ExtIntColours: true,
    ServiceTypes: true,
    ROStatuses: true,
    ServiceAdvisors: true,
    FranchiseServiceDepartments: true,
  });

  const result = await syncOtherTables(lookup);

  console.log('Lookup tables synced:', JSON.stringify(result));
  console.log(
    `FranchiseServiceDepartments: ${lookup.franchiseServiceDepartments.length} pair(s) from Evolve` +
      ` — labeled: ${lookup.franchiseServiceDepartments.filter((f) => f.franchiseLabel && f.serviceDeptLabel).length}`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error('syncLookupTables failed:', err);
  await pool.end();
  process.exit(1);
});
