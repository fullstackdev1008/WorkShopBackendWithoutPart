import fs from 'fs';
import path from 'path';
import { FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  roles,
  users,
  permissions,
  customers,
  customerAddresses,
  customerContacts,
  customerProfiles,
  vehicleMakes,
  vehicleModels,
  vehicles,
  vehicleImages,
  vehicleAccessories,
  vehicleCheckIns,
  vehicleCheckInPhotos,
  qcInspections,
  qcInspectionItems,
  qcInspectionPhotos,
  jobCards,
  jobCardItems,
  vehicleServiceHistory,
} from '../../db/models';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const DUMP_FILE = path.join(PUBLIC_DIR, 'load_data.json');

// ─── Dump: fetch all tables → save to public/load_data.json ──────────────────
export async function dumpDatabase(_request: FastifyRequest) {
  try {
    const [
      rolesData,
      usersData,
      permissionsData,
      customersData,
      customerAddressesData,
      customerContactsData,
      customerProfilesData,
      vehicleMakesData,
      vehicleModelsData,
      vehiclesData,
      vehicleImagesData,
      vehicleAccessoriesData,
      vehicleCheckInsData,
      vehicleCheckInPhotosData,
      qcInspectionsData,
      qcInspectionItemsData,
      qcInspectionPhotosData,
      jobCardsData,
      jobCardItemsData,
      vehicleServiceHistoryData,
    ] = await Promise.all([
      db.select().from(roles),
      db.select().from(users),
      db.select().from(permissions),
      db.select().from(customers),
      db.select().from(customerAddresses),
      db.select().from(customerContacts),
      db.select().from(customerProfiles),
      db.select().from(vehicleMakes),
      db.select().from(vehicleModels),
      db.select().from(vehicles),
      db.select().from(vehicleImages),
      db.select().from(vehicleAccessories),
      db.select().from(vehicleCheckIns),
      db.select().from(vehicleCheckInPhotos),
      db.select().from(qcInspections),
      db.select().from(qcInspectionItems),
      db.select().from(qcInspectionPhotos),
      db.select().from(jobCards),
      db.select().from(jobCardItems),
      db.select().from(vehicleServiceHistory),
    ]);

    const dump = {
      exportedAt: new Date().toISOString(),
      roles: rolesData,
      users: usersData,
      permissions: permissionsData,
      customers: customersData,
      customerAddresses: customerAddressesData,
      customerContacts: customerContactsData,
      customerProfiles: customerProfilesData,
      vehicleMakes: vehicleMakesData,
      vehicleModels: vehicleModelsData,
      vehicles: vehiclesData,
      vehicleImages: vehicleImagesData,
      vehicleAccessories: vehicleAccessoriesData,
      vehicleCheckIns: vehicleCheckInsData,
      vehicleCheckInPhotos: vehicleCheckInPhotosData,
      qcInspections: qcInspectionsData,
      qcInspectionItems: qcInspectionItemsData,
      qcInspectionPhotos: qcInspectionPhotosData,
      jobCards: jobCardsData,
      jobCardItems: jobCardItemsData,
      vehicleServiceHistory: vehicleServiceHistoryData,
    };

    // Ensure public dir exists
    if (!fs.existsSync(PUBLIC_DIR)) {
      fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    }

    fs.writeFileSync(DUMP_FILE, JSON.stringify(dump, null, 2), 'utf-8');

    return success('Database dumped successfully', {
      file: 'public/load_data.json',
      exportedAt: dump.exportedAt,
      counts: {
        roles: rolesData.length,
        users: usersData.length,
        permissions: permissionsData.length,
        customers: customersData.length,
        customerAddresses: customerAddressesData.length,
        customerContacts: customerContactsData.length,
        customerProfiles: customerProfilesData.length,
        vehicleMakes: vehicleMakesData.length,
        vehicleModels: vehicleModelsData.length,
        vehicles: vehiclesData.length,
        vehicleImages: vehicleImagesData.length,
        vehicleAccessories: vehicleAccessoriesData.length,
        vehicleCheckIns: vehicleCheckInsData.length,
        vehicleCheckInPhotos: vehicleCheckInPhotosData.length,
        qcInspections: qcInspectionsData.length,
        qcInspectionItems: qcInspectionItemsData.length,
        qcInspectionPhotos: qcInspectionPhotosData.length,
        jobCards: jobCardsData.length,
        jobCardItems: jobCardItemsData.length,
        vehicleServiceHistory: vehicleServiceHistoryData.length,
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Load: read public/load_data.json → insert into DB ───────────────────────
export async function loadDatabase(_request: FastifyRequest) {
  try {
    if (!fs.existsSync(DUMP_FILE)) {
      return error(HttpStatus.NOT_FOUND, 'load_data.json not found. Run /api/db/dump first.');
    }

    const raw = fs.readFileSync(DUMP_FILE, 'utf-8');
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
    const dump = JSON.parse(raw, (_key, value) => {
      if (typeof value === 'string' && isoDateRegex.test(value)) {
        return new Date(value);
      }
      return value;
    });

    const inserted: Record<string, number> = {};

    // Truncate all tables in one shot — PostgreSQL CASCADE handles FK order automatically.
    await db.execute(sql`
      TRUNCATE TABLE
        qc_inspection_photos, qc_inspection_items, qc_inspections,
        vehicle_check_in_photos, vehicle_check_ins,
        job_card_items, job_cards,
        vehicle_service_history, vehicle_images, vehicle_accessories,
        vehicles, vehicle_models, vehicle_makes,
        customer_profiles, customer_contacts, customer_addresses, customers,
        permissions, users, roles
      RESTART IDENTITY CASCADE
    `);

    // Insert in FK-safe order (parents before children) — tables are empty so no conflicts.
    async function insertBatch<T extends Record<string, unknown>>(
      table: any,
      tableName: string,
      rows: T[],
    ) {
      if (!rows || rows.length === 0) {
        inserted[tableName] = 0;
        return;
      }
      await db.insert(table).values(rows);
      inserted[tableName] = rows.length;
    }

    await insertBatch(roles,                 'roles',                 dump.roles);
    await insertBatch(users,                 'users',                 dump.users);
    await insertBatch(permissions,           'permissions',           dump.permissions);
    await insertBatch(customers,             'customers',             dump.customers);
    await insertBatch(customerAddresses,     'customerAddresses',     dump.customerAddresses);
    await insertBatch(customerContacts,      'customerContacts',      dump.customerContacts);
    await insertBatch(customerProfiles,      'customerProfiles',      dump.customerProfiles);
    await insertBatch(vehicleMakes,          'vehicleMakes',          dump.vehicleMakes);
    await insertBatch(vehicleModels,         'vehicleModels',         dump.vehicleModels);
    await insertBatch(vehicles,              'vehicles',              dump.vehicles);
    await insertBatch(vehicleImages,         'vehicleImages',         dump.vehicleImages);
    await insertBatch(vehicleAccessories,    'vehicleAccessories',    dump.vehicleAccessories);
    await insertBatch(vehicleCheckIns,       'vehicleCheckIns',       dump.vehicleCheckIns);
    await insertBatch(vehicleCheckInPhotos,  'vehicleCheckInPhotos',  dump.vehicleCheckInPhotos);
    await insertBatch(qcInspections,         'qcInspections',         dump.qcInspections);
    await insertBatch(qcInspectionItems,     'qcInspectionItems',     dump.qcInspectionItems);
    await insertBatch(qcInspectionPhotos,    'qcInspectionPhotos',    dump.qcInspectionPhotos);
    await insertBatch(jobCards,              'jobCards',              dump.jobCards);
    await insertBatch(jobCardItems,          'jobCardItems',          dump.jobCardItems);
    await insertBatch(vehicleServiceHistory, 'vehicleServiceHistory', dump.vehicleServiceHistory);

    return success('Data loaded into database successfully', {
      loadedFrom: 'public/load_data.json',
      exportedAt: dump.exportedAt,
      inserted,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
