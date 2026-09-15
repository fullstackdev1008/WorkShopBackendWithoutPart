import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  date,
  integer,
  numeric,
  char,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { customers } from './customers';
import { users } from './users';
import { vehicleImages } from './vehicleImages';
import { vehicleAccessories } from './vehicleAccessories';
import { vehicleCheckIns } from './vehicleCheckIns';
import { jobCards } from './jobCards';
import { vehicleServiceHistory } from './vehicleServiceHistory';

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    customerId: uuid('customer_id').references(() => customers.id),
    dealerId: uuid('dealer_id'),
    oemModel: varchar('oem_model', { length: 100 }),

    brand: varchar('brand', { length: 100 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    modelVariant: varchar('model_variant', { length: 150 }),

    manufacturingYear: integer('manufacturing_year'),

    vin: varchar('vin', { length: 50 }).notNull(),
    engineNumber: varchar('engine_number', { length: 100 }),
    registrationNumber: varchar('registration_number', { length: 50 }),

    extColour: varchar('ext_colour', { length: 100 }),
    intColour: varchar('int_colour', { length: 100 }),

    fuelType: varchar('fuel_type', { length: 50 }),
    transmissionType: varchar('transmission_type', { length: 50 }),

    odometerLast: integer('odometer_last').notNull(),

    deliveryDate: date('delivery_date'),

    vehStockNo: varchar('veh_stock_no', { length: 100 }),
    vehGlobalStockNo: varchar('veh_global_stock_no', { length: 100 }),
    factoryJobNo: varchar('factory_job_no', { length: 100 }),

    seriesDescription: varchar('series_description', { length: 150 }),
    modelDescription: varchar('model_description', { length: 150 }),
    modelCode: varchar('model_code', { length: 50 }),
    evolveSellingDate: date('evolve_selling_date'),

    // Company (dealership) that owns this vehicle in Evolve. A VIN exists in
    // exactly one company (client invariant); set/refreshed on every Evolve
    // FOUND. Nullable until known. `evolve_synced_at` records cache provenance.
    owningCompanyId: uuid('owning_company_id'),
    evolveSyncedAt: timestamp('evolve_synced_at', { withTimezone: true }),

    registrationDate: date('registration_date'),
    registrationYear: integer('registration_year'),
    defaultTaxCode: varchar('default_tax_code', { length: 50 }),
    purchaseTranCode: varchar('purchase_tran_code', { length: 50 }),
    dateStocked: date('date_stocked'),

    condition: varchar('condition', { length: 100 }),
    vehicleLocation: varchar('vehicle_location', { length: 150 }),

    nscNumber: varchar('nsc_number', { length: 100 }),
    microdotNumber: varchar('microdot_number', { length: 100 }),
    mmCode: varchar('mm_code', { length: 100 }),

    passengerCommercial: char('passenger_commercial', { length: 1 }),

    bodyType: varchar('body_type', { length: 100 }),
    engineCapacity: integer('engine_capacity'),

    totalInvoiceCostExcl: numeric('total_invoice_cost_excl', { precision: 12, scale: 2 }),
    lessAdvertisingExp: numeric('less_advertising_exp', { precision: 12, scale: 2 }),
    lessHoldback: numeric('less_holdback', { precision: 12, scale: 2 }),
    estimatedReconditioning: numeric('estimated_reconditioning', { precision: 12, scale: 2 }),

    retailPrice: numeric('retail_price', { precision: 12, scale: 2 }),
    totalMsrp: numeric('total_msrp', { precision: 12, scale: 2 }),
    addendumAmount: numeric('addendum_amount', { precision: 12, scale: 2 }),
    currentPrice: numeric('current_price', { precision: 12, scale: 2 }),

    depreciationPerc: numeric('depreciation_perc', { precision: 5, scale: 2 }),
    bookRetailAmount: numeric('book_retail_amount', { precision: 12, scale: 2 }),
    bookTradeAmount: numeric('book_trade_amount', { precision: 12, scale: 2 }),

    availableForResale: boolean('available_for_resale').default(false),
    certificationNo: varchar('certification_no', { length: 100 }),
    certifiedPreOwned: boolean('certified_pre_owned').default(false),

    daysStockedAtLocation: integer('days_stocked_at_location'),
    daysStockedBranch: integer('days_stocked_branch'),
    daysStockedCategoryChanged: integer('days_stocked_category_changed'),
    daysStockedGroup: integer('days_stocked_group'),

    dealerCertified: boolean('dealer_certified').default(false),

    deliveryKilometers: integer('delivery_kilometers'),
    driverContactNo: varchar('driver_contact_no', { length: 50 }),
    driverName: varchar('driver_name', { length: 150 }),

    fleetContractNo: varchar('fleet_contract_no', { length: 100 }),
    fleetController: varchar('fleet_controller', { length: 150 }),

    fullServiceHistory: boolean('full_service_history').default(false),
    importedVehicle: boolean('imported_vehicle').default(false),

    mvCertificationDate: date('mv_certification_date'),
    mvCertificationNumber: varchar('mv_certification_number', { length: 100 }),
    mvRegistrationDate: date('mv_registration_date'),
    mvRegistrationNumber: varchar('mv_registration_number', { length: 100 }),

    comments: text('comments'),
    previousOwners: integer('previous_owners'),

    rentalContract: varchar('rental_contract', { length: 100 }),
    rentalStartDatetime: timestamp('rental_start_datetime', { withTimezone: true }),
    rentalEndDatetime: timestamp('rental_end_datetime', { withTimezone: true }),
    rentalItemCategory: varchar('rental_item_category', { length: 100 }),

    reservedFor: varchar('reserved_for', { length: 150 }),
    reservedForBy: varchar('reserved_for_by', { length: 150 }),

    telematicsId: varchar('telematics_id', { length: 100 }),
    telematicsAssetId: varchar('telematics_asset_id', { length: 100 }),
    telematicsLocation: varchar('telematics_location', { length: 150 }),
    telematicsService: varchar('telematics_service', { length: 150 }),

    warrantyAcceptanceCert: boolean('warranty_acceptance_cert').default(false),
    warrantyAcceptanceCertDate: date('warranty_acceptance_cert_date'),
    warrantyActive: boolean('warranty_active').default(false),
    warrantyNumber: varchar('warranty_number', { length: 100 }),
    warrantyStartDate: date('warranty_start_date'),

    keyNumber: varchar('key_number', { length: 100 }),
    keyNumber2: varchar('key_number2', { length: 100 }),

    batteryVoltage: numeric('battery_voltage', { precision: 6, scale: 2 }),

    dateBuilt: date('date_built'),
    dateFirstSold: date('date_first_sold'),

    drive: varchar('drive', { length: 100 }),
    eTagNumber: varchar('e_tag_number', { length: 100 }),

    grossVehicleMass: numeric('gross_vehicle_mass', { precision: 10, scale: 2 }),
    immobiliserNumber: varchar('immobiliser_number', { length: 100 }),

    inServiceKilometers: integer('in_service_kilometers'),

    noOfCylinders: integer('no_of_cylinders'),
    noOfDoors: integer('no_of_doors'),
    noOfPassengers: integer('no_of_passengers'),
    noOfAxles: integer('no_of_axles'),

    odoType: varchar('odo_type', { length: 50 }),
    oemWarrantyEnd: date('oem_warranty_end'),

    provinceRegistered: varchar('province_registered', { length: 100 }),
    radioPin: varchar('radio_pin', { length: 100 }),

    sellingDealerCode: varchar('selling_dealer_code', { length: 100 }),
    serviceKey: varchar('service_key', { length: 100 }),

    traderId: varchar('trader_id', { length: 100 }),
    traderReference: varchar('trader_reference', { length: 100 }),

    unladenWeight: numeric('unladen_weight', { precision: 10, scale: 2 }),
    vehicleTrim: varchar('vehicle_trim', { length: 150 }),

    // ─── Security Gate Entry Fields ──────────────────────────────────────────
    entryTime: timestamp('entry_time', { withTimezone: true }),
    status: varchar('status', { length: 50 }).default('Entry (Draft)').notNull(),
    priority: varchar('priority', { length: 20 }).default('STANDARD').notNull(),
    serviceType: varchar('service_type', { length: 50 }).default('GENERAL_SERVICE').notNull(),

    isActive: boolean('is_active').notNull().default(true),

    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Partial unique: only one non-Archived entry per VIN. Re-entries archive the old row.
    uniqueVin: uniqueIndex('uq_vehicles_vin_active').on(t.vin).where(sql`${t.status} <> 'Archived'`),
    // Same rule for registration number — one active row per plate at a time.
    uniqueRegistration: uniqueIndex('uq_vehicles_registration_active')
      .on(t.registrationNumber)
      .where(sql`${t.status} <> 'Archived'`),
    stockNoIdx: index('idx_vehicles_stock_no').on(t.vehStockNo),
    registrationIdx: index('idx_vehicles_registration').on(t.registrationNumber),
    customerIdIdx: index('idx_vehicles_customer_id').on(t.customerId),
    dealerIdIdx: index('idx_vehicles_dealer_id').on(t.dealerId),
    owningCompanyIdIdx: index('idx_vehicles_owning_company_id').on(t.owningCompanyId),
  }),
);

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  customer: one(customers, {
    fields: [vehicles.customerId],
    references: [customers.id],
  }),
  images: many(vehicleImages),
  accessories: many(vehicleAccessories),
  checkIns: many(vehicleCheckIns),
  jobCards: many(jobCards),
  serviceHistory: many(vehicleServiceHistory),
}));

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
