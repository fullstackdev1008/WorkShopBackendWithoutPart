/**
 * READ-ONLY diagnostic: is the Engine Number actually reaching Evolve?
 *
 * Usage (run from the deployed app directory — the one holding .env and dist/):
 *   node scripts/diag-engine-number.mjs KFT69FYGP FO008450
 *
 * Optional override when the build lives outside ./dist:
 *   EVOLVE_DIST=/abs/path/to/dist/services/evolveIrm.service.js \
 *     node scripts/diag-engine-number.mjs KFT69FYGP FO008450
 *
 * It answers, for one registration + Evolve RO number:
 *   1. what vehicles.engine_number actually holds (NULL vs '' vs spaces vs value)
 *   2. whether that RO is one of ours (job_cards.evolve_ro_number)
 *   3. whether the DEPLOYED build has the OLD EngineNumber logic (always emits,
 *      blank included) or the NEW logic (omits the tag when blank)
 *   4. the exact <EngineNumber> line that build produces for this vehicle
 *
 * SAFETY — this script:
 *   - runs every query inside BEGIN TRANSACTION READ ONLY, so Postgres itself
 *     rejects any INSERT / UPDATE / DELETE
 *   - issues SELECTs only
 *   - makes NO Evolve API call: it touches only buildRoMaintenanceXml, a pure
 *     string builder (no DB, no network). roMaintenance() and evolveHttpPost()
 *     are never imported or invoked.
 *   - never imports the job-card sync service, so no sync status, attempt count
 *     or timestamp is written
 *
 * Reads DATABASE_URL from .env via dotenv — the same variable src/db/index.ts uses.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REG = process.argv[2] || 'KFT69FYGP';
const RO  = process.argv[3] || 'FO008450';
const require = createRequire(import.meta.url);

const banner = (t) => console.log(`\n${'='.repeat(64)}\n${t}\n${'='.repeat(64)}`);
const show = (v) => {
  if (v === null || v === undefined) return 'NULL';
  const s = String(v);
  if (s === '') return "'' (empty string)";
  if (s.trim() === '') return `${JSON.stringify(s)} (whitespace only)`;
  return JSON.stringify(s);
};
const yn = (b) => (b ? 'YES' : 'NO');

banner(`ENGINE NUMBER → EVOLVE DIAGNOSTIC   reg=${REG}   ro=${RO}`);
console.log('cwd                  :', process.cwd());
console.log('DATABASE_URL (masked):',
  (process.env.DATABASE_URL || '(unset)').replace(/(:\/\/[^:]+:)[^@]*(@)/, '$1***$2'));

if (!process.env.DATABASE_URL) {
  console.error('\nDATABASE_URL is not set. Run this from the app directory that holds .env.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let vehicleRow = null;

try {
  const client = await pool.connect();
  try {
    // Hard guarantee: Postgres refuses any write inside this transaction.
    await client.query('BEGIN TRANSACTION READ ONLY');

    const who = await client.query('SELECT current_database() AS db, current_user AS usr');
    console.log('connected to DB      :', who.rows[0].db, 'as', who.rows[0].usr);

    // ── STEP 1 — the vehicle row ────────────────────────────────────────────
    banner('STEP 1 — vehicles row (source of truth for engine_number)');
    const veh = await client.query(
      `SELECT id,
              registration_number,
              vin,
              engine_number,
              length(engine_number) AS engine_len,
              brand, model, model_code,
              customer_id, owning_company_id,
              evolve_synced_at, created_at, updated_at
         FROM vehicles
        WHERE upper(replace(registration_number, ' ', '')) = upper(replace($1, ' ', ''))
        ORDER BY updated_at DESC NULLS LAST`,
      [REG],
    );

    if (veh.rowCount === 0) {
      console.log(`NOT FOUND — no vehicles row matches registration ${REG}`);
      console.log('  => this vehicle does not exist in this database.');
    } else {
      if (veh.rowCount > 1) {
        console.log(`WARNING: ${veh.rowCount} vehicles match this registration; using the most recently updated.`);
      }
      vehicleRow = veh.rows[0];
      for (const [i, r] of veh.rows.entries()) {
        const e = r.engine_number;
        const isNull = e === null || e === undefined;
        const isEmpty = e === '';
        const isSpaces = !isNull && !isEmpty && String(e).trim() === '';
        console.log(`\n--- vehicle ${i + 1} of ${veh.rowCount} ---`);
        console.log('1. registration_number      :', show(r.registration_number));
        console.log('2. vin                      :', show(r.vin));
        console.log('3. engine_number (raw)      :', show(e));
        console.log('   engine_number length     :', r.engine_len === null ? 'n/a (NULL)' : r.engine_len);
        console.log('4. is NULL?                 :', yn(isNull));
        console.log('5. is empty string?         :', yn(isEmpty));
        console.log('6. is whitespace only?      :', yn(isSpaces));
        console.log('   vehicle id               :', r.id);
        console.log('   brand / model            :', r.brand, '/', r.model, ' model_code:', show(r.model_code));
        console.log('   customer_id              :', r.customer_id);
        console.log('   owning_company_id        :', r.owning_company_id);
        console.log('   evolve_synced_at         :', r.evolve_synced_at);
        console.log('   created_at / updated_at  :', r.created_at, '/', r.updated_at);
      }
    }

    // ── STEP 2 — the job card / RO ──────────────────────────────────────────
    banner('STEP 2 — job card / Evolve RO');
    const byRo = await client.query(
      `SELECT jc.id AS job_card_id,
              jc.status,
              jc.evolve_ro_number,
              jc.evolve_crm_ro_ref,
              jc.evolve_sync_status,
              jc.evolve_synced_at,
              jc.evolve_last_error,
              jc.evolve_attempt_count,
              jc.evolve_next_attempt_at,
              jc.vehicle_id,
              jc.created_at, jc.updated_at,
              v.registration_number, v.vin, v.engine_number
         FROM job_cards jc
         JOIN vehicles v ON v.id = jc.vehicle_id
        WHERE jc.evolve_ro_number = $1`,
      [RO],
    );
    console.log(`job cards with evolve_ro_number = ${RO}: ${byRo.rowCount}`);
    for (const r of byRo.rows) console.log(JSON.stringify(r, null, 2));
    if (byRo.rowCount === 0) {
      console.log(`  => ${RO} is NOT recorded against any job card in this database.`);
      console.log('     Either it was created directly in Evolve, or our CREATE never stored the number.');
    }

    if (vehicleRow) {
      const forVeh = await client.query(
        `SELECT id AS job_card_id, status, evolve_ro_number, evolve_sync_status,
                evolve_synced_at, evolve_last_error, evolve_attempt_count, created_at
           FROM job_cards
          WHERE vehicle_id = $1
          ORDER BY created_at DESC`,
        [vehicleRow.id],
      );
      console.log(`\nall job cards for this vehicle: ${forVeh.rowCount}`);
      for (const r of forVeh.rows) console.log(' ', JSON.stringify(r));
    }

    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
} catch (err) {
  console.error('\nDB ERROR:', err.message);
} finally {
  await pool.end();
}

// ── STEP 3 — which EngineNumber logic is deployed? ─────────────────────────
banner('STEP 3 — EngineNumber logic in the DEPLOYED build');
const distPath = process.env.EVOLVE_DIST
  ? path.resolve(process.env.EVOLVE_DIST)
  : path.resolve(process.cwd(), 'dist/services/evolveIrm.service.js');
console.log('build file :', distPath);

let isNewLogic = null;
if (!existsSync(distPath)) {
  console.log('NOT FOUND — pass EVOLVE_DIST=/abs/path/to/dist/services/evolveIrm.service.js');
} else {
  const src = readFileSync(distPath, 'utf8');
  const lines = src.split('\n');
  // Match the EMIT statement, not the explanatory comment that also names the tag.
  const idx = lines.findIndex((l) => l.includes('xml +=') && l.includes('<EngineNumber>'));
  const guarded = /if \(String\(p\.engineNumber[^\n]*\n\s*xml \+= `\s*<EngineNumber>/.test(src);
  // Built before 2026-09-08 12:03 IST (commit dc98c24) => necessarily the OLD logic.
  console.log('build mtime:', statSync(distPath).mtime.toISOString());
  console.log('emit line  :', idx >= 0 ? `${idx + 1}: ${lines[idx].trim()}` : '(no emit statement found)');
  isNewLogic = guarded;
  console.log('7. production EngineNumber behaviour:',
    guarded
      ? 'NEW  → emits <EngineNumber> ONLY when the value is non-blank (omits the tag otherwise)'
      : 'OLD  → ALWAYS emits <EngineNumber>, including as an empty tag when the value is blank');
}

// ── STEP 4 — the exact tag this build produces for this vehicle ────────────
banner('STEP 4 — exact <EngineNumber> output for this vehicle');
if (!vehicleRow) {
  console.log('VERDICT: CANNOT DETERMINE — no vehicle row found for registration ' + REG);
} else {
  // Mirrors buildRoInput exactly: engineNumber: row.engineNumber ?? ''
  // (src/services/jobCardEvolveSync.service.ts:722)
  const engineNumber = vehicleRow.engine_number ?? '';
  console.log('value handed to the XML builder:', show(engineNumber));

  let xml = null;
  let loadError = null;
  try {
    const mod = require(distPath);
    if (typeof mod.buildRoMaintenanceXml === 'function') {
      // Pure string builder — no network, no DB. The <EngineNumber> branch
      // depends on p.engineNumber ALONE, so the placeholders below cannot
      // influence the line under test.
      xml = mod.buildRoMaintenanceXml({
        crmReferenceNo: 'DIAG-READONLY',
        roNumber: RO,
        registrationNo: vehicleRow.registration_number ?? '',
        vin: vehicleRow.vin ?? '',
        engineNumber,
        ownerCustSequenceId: 'DIAG',
        make: vehicleRow.brand ?? '',
        modelCode: vehicleRow.model_code ?? '',
        modelDescription: vehicleRow.model ?? '',
        modelYear: '',
        odoIn: 0,
        appointmentDate: '',
        valueCpaEstimate: '0',
        customerStates: '',
        saInstruction: '',
      });
    }
  } catch (err) {
    loadError = err.message;
  }

  if (xml) {
    console.log('method : REAL — called the deployed buildRoMaintenanceXml()');
    const tagLines = xml.split('\n').filter((l) => l.includes('EngineNumber'));
    const context = xml.split('\n').filter((l) => /RegistrationNo|VehVinNumber|EngineNumber|ModelYear/.test(l));
    console.log('generated XML (relevant lines):\n' + context.join('\n'));
    if (tagLines.length === 0) {
      console.log('\n8. VERDICT: TAG COMPLETELY OMITTED');
    } else if (/<EngineNumber>\s*<\/EngineNumber>/.test(tagLines.join('\n'))) {
      console.log('\n8. VERDICT: TAG ALWAYS PRESENT → <EngineNumber></EngineNumber>');
    } else {
      console.log(`\n8. VERDICT: TAG PRESENT → ${tagLines.join(' | ').trim()}`);
    }
  } else {
    console.log('method : SIMULATED —', loadError
      ? `the build module could not be loaded (${String(loadError).split('\n')[0]})`
      : 'this build does not export buildRoMaintenanceXml (older builds keep it module-private)');
    console.log('         The STEP 3 detection is authoritative here; the verdict below follows from it.');
    const hasValue = String(engineNumber).trim() !== '';
    if (isNewLogic === true) {
      console.log(hasValue
        ? `\n8. VERDICT: TAG PRESENT → <EngineNumber>${engineNumber}</EngineNumber>`
        : '\n8. VERDICT: TAG COMPLETELY OMITTED');
    } else if (isNewLogic === false) {
      console.log(hasValue
        ? `\n8. VERDICT: TAG PRESENT → <EngineNumber>${engineNumber}</EngineNumber>`
        : '\n8. VERDICT: TAG ALWAYS PRESENT → <EngineNumber></EngineNumber>');
    } else {
      console.log('\n8. VERDICT: CANNOT DETERMINE — the deployed build file could not be read.');
    }
  }
}

console.log('\nDone. No rows were written and no Evolve request was sent.\n');
