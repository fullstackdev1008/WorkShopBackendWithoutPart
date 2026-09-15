/**
 * Seed Model Service Type Assignments for FAW "JH6 28.500FT A/T T/T C/C".
 *
 * Service Type = AMC, Service Category = B / C / D Service, reusing the FAW
 * J6 500 parts lists.
 *
 * Storage note (matches the frontend's "swapped" save — see
 * model-service-types/service.ts):
 *   - service_type_id     column stores the CATEGORY (B/C/D)
 *   - service_category_id column stores the TYPE     (AMC)
 *
 * Idempotent: skips any make+model+category+AMC combo already present.
 *
 * Run on the server (where .env points DATABASE_URL at the target DB):
 *     node scripts/seed-jh6-amc.mjs
 */
import 'dotenv/config';
import { Pool } from 'pg';

const MAKE_NAME = 'FAW';
const MODEL_NAME = 'JH6 28.500FT A/T T/T C/C';
const AMC_CODE = 'AMC_SERVICE';

const B_SERVICE_PARTS = [
  { partCode: 'LABOUR',           partName: 'LABOUR - B SERVICE',            quantity: '8',  unitPrice: '650.00' },
  { partCode: 'SARL3511AA039',    partName: 'AIR DRIER FILTER ELEMENT',      quantity: '1',  unitPrice: '263.93' },
  { partCode: '11090702000C00',   partName: 'AIR FILTER ELEMENT INNER / PRI',quantity: '1',  unitPrice: '449.76' },
  { partCode: '11090602000C00',   partName: 'AIR FILTER ELEMENT OUTER / SEC',quantity: '1',  unitPrice: '1424.76' },
  { partCode: 'PT3406',           partName: 'ENGINE OIL DIESEL',             quantity: '38', unitPrice: '95.90' },
  { partCode: '1117050M002060AA', partName: 'FUEL FILTER DIESEL',            quantity: '2',  unitPrice: '533.69' },
  { partCode: '1012010M18054W',   partName: 'OIL FILTER',                    quantity: '2',  unitPrice: '397.62' },
  { partCode: '101701529DM',      partName: 'OIL FILTER SPINNER/ROTARY TYPE',quantity: '1',  unitPrice: '582.99' },
  { partCode: '9971239',          partName: 'SHOP SUPPLIES',                 quantity: '1',  unitPrice: '300.00' },
  { partCode: 'U00153',           partName: 'GREASE CHASSIS',                quantity: '3',  unitPrice: '195.69' },
  { partCode: '11050502007',      partName: 'FUEL FILTER DIESEL WATER TRAP', quantity: '1',  unitPrice: '1352.85' },
];

const C_SERVICE_PARTS = [
  { partCode: 'LABOUR',           partName: 'LABOUR - C SERVICE',            quantity: '6',  unitPrice: '650.00' },
  { partCode: 'SARL3511AA039',    partName: 'AIR DRIER FILTER ELEMENT',      quantity: '1',  unitPrice: '263.93' },
  { partCode: '11090702000C00',   partName: 'AIR FILTER ELEMENT INNER / PRI',quantity: '1',  unitPrice: '449.76' },
  { partCode: '11090602000C00',   partName: 'AIR FILTER ELEMENT OUTER / SEC',quantity: '1',  unitPrice: '1424.76' },
  { partCode: 'PT3406',           partName: 'ENGINE OIL DIESEL',             quantity: '38', unitPrice: '95.90' },
  { partCode: '1117050M002060AA', partName: 'FUEL FILTER DIESEL',            quantity: '2',  unitPrice: '533.69' },
  { partCode: '1012010M18054W',   partName: 'OIL FILTER',                    quantity: '2',  unitPrice: '397.62' },
  { partCode: '101701529DM',      partName: 'OIL FILTER SPINNER/ROTARY TYPE',quantity: '1',  unitPrice: '582.99' },
  { partCode: '9971239',          partName: 'SHOP SUPPLIES',                 quantity: '1',  unitPrice: '300.00' },
  { partCode: '8113010B45C00',    partName: 'AIR CONDITIONER DUST FILTER',   quantity: '1',  unitPrice: '365.46' },
  { partCode: 'U00153',           partName: 'GREASE CHASSIS',                quantity: '3',  unitPrice: '195.69' },
  { partCode: '11050502007',      partName: 'FUEL FILTER DIESEL WATER TRAP', quantity: '1',  unitPrice: '1352.85' },
];

const D_SERVICE_PARTS = [
  { partCode: 'LABOUR',           partName: 'LABOUR - MAJOR SERVICE',        quantity: '12', unitPrice: '650.00' },
  { partCode: 'SARL3511AA039',    partName: 'AIR DRIER FILTER ELEMENT',      quantity: '1',  unitPrice: '263.93' },
  { partCode: 'P00345',           partName: 'ANTI FREEZE',                   quantity: '48', unitPrice: '72.05' },
  { partCode: '11090702000C00',   partName: 'AIR FILTER ELEMENT INNER / PRI',quantity: '1',  unitPrice: '449.76' },
  { partCode: '11090602000C00',   partName: 'AIR FILTER ELEMENT OUTER / SEC',quantity: '1',  unitPrice: '1424.76' },
  { partCode: '1023022M5002000',  partName: 'V-BELT ALTERNATOR',             quantity: '1',  unitPrice: '704.27' },
  { partCode: '1023021M5002000',  partName: 'V-BELT AIR CONDITIONER',        quantity: '1',  unitPrice: '489.69' },
  { partCode: 'PT3406',           partName: 'ENGINE OIL DIESEL',             quantity: '38', unitPrice: '95.90' },
  { partCode: '1117050M002060A',  partName: 'FUEL FILTER DIESEL',            quantity: '2',  unitPrice: '533.69' },
  { partCode: '1012010M18054W',   partName: 'OIL FILTER',                    quantity: '2',  unitPrice: '397.62' },
  { partCode: '101701529DM',      partName: 'OIL FILTER SPINNER/ROTARY TYPE',quantity: '1',  unitPrice: '582.99' },
  { partCode: 'P05201',           partName: 'POWERSTEERING OIL / FLUID',     quantity: '4',  unitPrice: '75.38' },
  { partCode: '3408015716',       partName: 'POWERSTEERING OIL FILTER',      quantity: '1',  unitPrice: '134.20' },
  { partCode: '0009971239',       partName: 'SHOP SUPPLIES (ALT)',            quantity: '1',  unitPrice: '300.00' },
  { partCode: 'GT5905',           partName: 'TRANSMISSION FLUID 1 LITRE',    quantity: '19', unitPrice: '283.36' },
  { partCode: '1017010AM500000',  partName: 'OIL FILTER (BYPASS)',           quantity: '1',  unitPrice: '1999.88' },
  { partCode: 'GT4645',           partName: 'DIFF OIL REAR',                 quantity: '40', unitPrice: '64.74' },
  { partCode: 'PT6621',           partName: 'BRAKE FLUID',                   quantity: '2',  unitPrice: '114.75' },
  { partCode: '8113010B45C00',    partName: 'AIR CONDITIONER DUST FILTER',   quantity: '1',  unitPrice: '365.46' },
  { partCode: 'U00153',           partName: 'GREASE CHASSIS',                quantity: '3',  unitPrice: '195.69' },
  { partCode: '1530002741',       partName: 'RETARDER OIL FILTER',           quantity: '1',  unitPrice: '3727.27' },
  { partCode: '11050502007',      partName: 'FUEL FILTER DIESEL WATER TRAP', quantity: '1',  unitPrice: '1352.85' },
];

const CATEGORIES = [
  { code: 'B_SERVICE', parts: B_SERVICE_PARTS },
  { code: 'C_SERVICE', parts: C_SERVICE_PARTS },
  { code: 'D_SERVICE', parts: D_SERVICE_PARTS },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log(`Seeding AMC B/C/D assignments for ${MAKE_NAME} "${MODEL_NAME}"...`);

  const makeRes = await pool.query('SELECT id FROM vehicle_makes WHERE name = $1 LIMIT 1', [MAKE_NAME]);
  if (!makeRes.rowCount) throw new Error(`Make "${MAKE_NAME}" not found.`);
  const makeId = makeRes.rows[0].id;

  let modelRes = await pool.query(
    'SELECT id FROM vehicle_models WHERE make_id = $1 AND name = $2 LIMIT 1',
    [makeId, MODEL_NAME],
  );
  let modelId;
  if (!modelRes.rowCount) {
    const ins = await pool.query(
      'INSERT INTO vehicle_models (make_id, name) VALUES ($1, $2) RETURNING id',
      [makeId, MODEL_NAME],
    );
    modelId = ins.rows[0].id;
    console.log(`  Created model "${MODEL_NAME}".`);
  } else {
    modelId = modelRes.rows[0].id;
    console.log(`  Model "${MODEL_NAME}" already exists.`);
  }

  const amcRes = await pool.query('SELECT id FROM service_types WHERE code = $1 LIMIT 1', [AMC_CODE]);
  if (!amcRes.rowCount) throw new Error(`Service type "${AMC_CODE}" not found.`);
  const amcId = amcRes.rows[0].id;

  let created = 0;
  let skipped = 0;
  for (const { code, parts } of CATEGORIES) {
    const catRes = await pool.query('SELECT id FROM service_types WHERE code = $1 LIMIT 1', [code]);
    if (!catRes.rowCount) { console.warn(`  Skipping ${code}: service type not found.`); continue; }
    const catId = catRes.rows[0].id;

    const existing = await pool.query(
      `SELECT id FROM model_service_type_assignments
         WHERE make_id = $1 AND model_id = $2 AND service_type_id = $3 AND service_category_id = $4
         LIMIT 1`,
      [makeId, modelId, catId, amcId],
    );
    if (existing.rowCount) {
      console.log(`  ${code}: already assigned — skipping ${parts.length} parts.`);
      skipped += parts.length;
      continue;
    }

    for (const p of parts) {
      await pool.query(
        `INSERT INTO model_service_type_assignments
           (make_id, model_id, service_type_id, service_category_id, part_code, part_name, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [makeId, modelId, catId, amcId, p.partCode, p.partName, p.quantity, p.unitPrice],
      );
    }
    console.log(`  ${code}: created ${parts.length} parts.`);
    created += parts.length;
  }

  console.log(`Done! Created ${created} part rows, skipped ${skipped}.`);
}

main()
  .catch((err) => { console.error('Seed failed:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
