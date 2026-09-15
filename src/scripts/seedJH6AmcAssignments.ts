/**
 * Seed Model Service Type Assignments for FAW "JH6 28.500FT A/T T/T C/C".
 *
 * Creates B / C / D Service assignments under Service Type = AMC, reusing the
 * same FAW parts lists already used for the J6 500 seed.
 *
 * NOTE on the deliberately "swapped" storage (see model-service-types/service.ts):
 *   - DB column `service_type_id`     stores the Service CATEGORY (B/C/D)
 *   - DB column `service_category_id` stores the Service TYPE     (AMC)
 * The frontend saves them swapped, so we mirror that here.
 *
 * Idempotent: re-running skips category assignments that already exist for this
 * make + model + category + AMC combination.
 *
 * Run against whichever DB `DATABASE_URL` (in .env) points at:
 *     npx ts-node-dev --transpile-only src/scripts/seedJH6AmcAssignments.ts
 */
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db';
import {
  vehicleMakes,
  vehicleModels,
  serviceTypes,
  modelServiceTypeAssignments,
} from '../db/models';

const MAKE_NAME = 'FAW';
const MODEL_NAME = 'JH6 28.500FT A/T T/T C/C';
const AMC_CODE = 'AMC_SERVICE';

// ─── Parts (reused from the FAW J6 500 seed) ─────────────────────────────────

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

const CATEGORIES: { code: string; parts: typeof B_SERVICE_PARTS }[] = [
  { code: 'B_SERVICE', parts: B_SERVICE_PARTS },
  { code: 'C_SERVICE', parts: C_SERVICE_PARTS },
  { code: 'D_SERVICE', parts: D_SERVICE_PARTS },
];

async function seed() {
  console.log(`Seeding AMC B/C/D assignments for ${MAKE_NAME} "${MODEL_NAME}"...`);

  // 1. Make
  const [make] = await db
    .select({ id: vehicleMakes.id })
    .from(vehicleMakes)
    .where(eq(vehicleMakes.name, MAKE_NAME))
    .limit(1);
  if (!make) throw new Error(`Make "${MAKE_NAME}" not found. Seed vehicle makes first.`);

  // 2. Model — create if missing
  let [model] = await db
    .select({ id: vehicleModels.id })
    .from(vehicleModels)
    .where(and(eq(vehicleModels.makeId, make.id), eq(vehicleModels.name, MODEL_NAME)))
    .limit(1);
  if (!model) {
    [model] = await db
      .insert(vehicleModels)
      .values({ makeId: make.id, name: MODEL_NAME })
      .returning({ id: vehicleModels.id });
    console.log(`  Created model "${MODEL_NAME}".`);
  } else {
    console.log(`  Model "${MODEL_NAME}" already exists.`);
  }

  // 3. AMC service type → stored in the service_category_id column
  const [amc] = await db
    .select({ id: serviceTypes.id })
    .from(serviceTypes)
    .where(eq(serviceTypes.code, AMC_CODE))
    .limit(1);
  if (!amc) throw new Error(`Service type "${AMC_CODE}" not found. Seed service types first.`);

  // 4. B/C/D service types → stored in the service_type_id column
  let created = 0;
  let skipped = 0;
  for (const { code, parts } of CATEGORIES) {
    const [cat] = await db
      .select({ id: serviceTypes.id })
      .from(serviceTypes)
      .where(eq(serviceTypes.code, code))
      .limit(1);
    if (!cat) {
      console.warn(`  Skipping ${code}: service type not found.`);
      continue;
    }

    // Idempotency: skip if this make+model+category+AMC combo already has rows
    const existing = await db
      .select({ id: modelServiceTypeAssignments.id })
      .from(modelServiceTypeAssignments)
      .where(
        and(
          eq(modelServiceTypeAssignments.makeId, make.id),
          eq(modelServiceTypeAssignments.modelId, model.id),
          eq(modelServiceTypeAssignments.serviceTypeId, cat.id),
          eq(modelServiceTypeAssignments.serviceCategoryId, amc.id),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ${code}: already assigned — skipping ${parts.length} parts.`);
      skipped += parts.length;
      continue;
    }

    await db.insert(modelServiceTypeAssignments).values(
      parts.map((p) => ({
        makeId: make.id,
        modelId: model.id,
        serviceTypeId: cat.id,       // B/C/D category (swapped column)
        serviceCategoryId: amc.id,   // AMC service type (swapped column)
        partCode: p.partCode,
        partName: p.partName,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
      })),
    );
    console.log(`  ${code}: created ${parts.length} parts.`);
    created += parts.length;
  }

  console.log(`Done! Created ${created} part rows, skipped ${skipped}.`);
}

seed()
  .catch((err) => { console.error('Seed failed:', err); process.exit(1); })
  .finally(() => pool.end());
