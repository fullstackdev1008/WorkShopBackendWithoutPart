/**
 * Per-company Franchise / Service-Dept sync — run on the SERVER via node.
 *
 *   node dist/scripts/syncFranchisesPerCompany.js            # every active company
 *   node dist/scripts/syncFranchisesPerCompany.js 10EC 20EC  # selected codes
 *   (or: npm run sync:franchises)
 *
 * WHY THIS EXISTS
 * IRM_GetLookupDropdownTables is answered per InterfaceCode, so the
 * FranchiseServiceDepartments rows belong to ONE company. `sync:lookups` uses
 * the single env InterfaceCode and therefore writes unscoped rows (company_id
 * NULL) that every company sees. This script calls Evolve once per active
 * company with that company's own InterfaceCode and tags the rows with its id,
 * which is what the job-card dropdown filters on.
 *
 * Requests ONLY FranchiseServiceDepartments — the other lookups (colours,
 * provinces, service types, …) are company-independent and stay with
 * `sync:lookups`, so this does not duplicate or fight that script.
 *
 * Safe to re-run: every write is an upsert keyed on
 * (company_id, franchise_seq_id, sd_number). It never deletes, and it never
 * touches the unscoped legacy rows.
 */
import 'dotenv/config';
import { pool } from '../db';
import { fetchLookupTables, syncOtherTables } from '../services/masterDataSync.service';
import { companyResolver } from '../services/companyResolver.service';

async function main() {
  const wanted = process.argv.slice(2).map((c) => c.trim().toUpperCase()).filter(Boolean);

  const active = await companyResolver.listActive();
  const targets = wanted.length ? active.filter((c) => wanted.includes(c.code.toUpperCase())) : active;

  if (!targets.length) {
    console.error(
      wanted.length
        ? `No active company matches: ${wanted.join(', ')} (active: ${active.map((c) => c.code).join(', ') || 'none'})`
        : 'No active companies — nothing to sync.',
    );
    process.exitCode = 1;
    return;
  }

  // Report per company rather than aborting the whole run on one failure: a
  // company whose Evolve endpoint is down must not block the other's refresh.
  let failures = 0;
  for (const company of targets) {
    const resolved = await companyResolver.getById(company.id);
    const interfaceCode = resolved?.interfaceCode;
    if (!interfaceCode) {
      console.error(`${company.code}: no InterfaceCode on record — skipped.`);
      failures++;
      continue;
    }

    try {
      console.log(`${company.code}: fetching FranchiseServiceDepartments (InterfaceCode ${interfaceCode})...`);
      const lookup = await fetchLookupTables({ FranchiseServiceDepartments: true }, interfaceCode);
      const pairs = lookup.franchiseServiceDepartments;
      const labeled = pairs.filter((f) => f.franchiseLabel && f.serviceDeptLabel).length;

      await syncOtherTables(lookup, company.id);

      console.log(`${company.code}: ${pairs.length} pair(s), ${labeled} labeled.`);
      for (const p of pairs) {
        console.log(
          `    FranchiseSeqID=${p.franchiseSeqId} SDNumber=${p.sdNumber}` +
            ` "${p.franchiseLabel ?? '(unlabeled)'}" / "${p.serviceDeptLabel ?? '(unlabeled)'}"`,
        );
      }
    } catch (err) {
      console.error(`${company.code}: sync failed —`, err instanceof Error ? err.message : err);
      failures++;
    }
  }

  if (failures) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('syncFranchisesPerCompany failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
