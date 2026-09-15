import { z } from 'zod';

export const VEHICLE_STATUSES = [
  'Entry (Draft)',
  'Vehicle IN',
  'Inspection (Draft)',
  'Inspection Done',
  'Job Card (Draft)',
  'Job Card (Pending Parts Approval)',
  'Job Card (Parts Approval Done)',
  'Job Card (Pending Cust. Approval)',
  'Job Card (Partial Cust. Approval)',
  'Job Card (Full Cust. Approval)',
  'In Service',
  'Ready for Billing',
  'Completed',
  'Cancelled',
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_PRIORITIES = [
  'BASIC',
  'STANDARD',
  'EXPRESS',
  'URGENT',
] as const;

export type VehiclePriority = (typeof VEHICLE_PRIORITIES)[number];

export const SERVICE_TYPES = [
  'GENERAL_SERVICE',
  'REPAIR',
  'WARRANTY',
  'INSPECTION',
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const optStr = (max: number) => z.string().max(max).nullish();
const optInt = () => z.number().int().nullish();
const optBool = () => z.boolean().nullish();
const optDate = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .nullish();
const optDatetime = () =>
  z
    .string()
    .datetime()
    .transform((v) => new Date(v))
    .nullish();
const optNumeric = () =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, 'Must be a numeric value')
    .nullish();
const optUuid = () => z.string().uuid().nullish();

// ─── Add Vehicle ──────────────────────────────────────────────────────────────
export const addVehicleSchema = z.object({
  // Required
  brand: z.string({ required_error: 'Brand is required' }).min(1).max(100),
  model: z.string({ required_error: 'Model is required' }).min(1).max(100),
  manufacturingYear: z
    .number({ required_error: 'Manufacturing year is required' })
    .int()
    .min(1900)
    .max(2100),
  vin: z
    .string({ required_error: 'VIN is required' })
    .min(1, 'VIN cannot be empty')
    .max(50)
    .transform((v) => v.trim().toUpperCase()),
  odometerLast: z
    .number({ required_error: 'Odometer last is required' })
    .int()
    .min(0),

  priority: z.enum(VEHICLE_PRIORITIES).default('STANDARD'),
  // Service type codes come from the service_types table — kept as a free-form string
  serviceType: z.string().min(1).max(50).default('GENERAL_SERVICE'),

  // References
  customerId: optUuid(),
  dealerId: optUuid(),

  // Vehicle info
  oemModel: optStr(100),
  modelVariant: optStr(150),
  engineNumber: optStr(100),
  registrationNumber: optStr(50).transform((v) => (v ? v.trim().toUpperCase() : v)),

  extColour: optStr(100),
  intColour: optStr(100),

  fuelType: optStr(50),
  transmissionType: optStr(50),

  deliveryDate: optDate(),

  vehStockNo: optStr(100),
  vehGlobalStockNo: optStr(100),
  factoryJobNo: optStr(100),

  seriesDescription: optStr(150),
  modelDescription: optStr(150),
  modelCode: optStr(50),

  registrationDate: optDate(),
  registrationYear: z.number().int().min(1900).max(2100).optional().nullable(),
  defaultTaxCode: optStr(50),
  purchaseTranCode: optStr(50),
  dateStocked: optDate(),

  condition: optStr(100),
  vehicleLocation: optStr(150),

  nscNumber: optStr(100),
  microdotNumber: optStr(100),
  mmCode: optStr(100),

  passengerCommercial: z.string().length(1).nullish(),

  bodyType: optStr(100),
  engineCapacity: optInt(),

  // Financials
  totalInvoiceCostExcl: optNumeric(),
  lessAdvertisingExp: optNumeric(),
  lessHoldback: optNumeric(),
  estimatedReconditioning: optNumeric(),
  retailPrice: optNumeric(),
  totalMsrp: optNumeric(),
  addendumAmount: optNumeric(),
  currentPrice: optNumeric(),
  depreciationPerc: optNumeric(),
  bookRetailAmount: optNumeric(),
  bookTradeAmount: optNumeric(),

  // Flags & stock
  availableForResale: optBool(),
  certificationNo: optStr(100),
  certifiedPreOwned: optBool(),

  daysStockedAtLocation: optInt(),
  daysStockedBranch: optInt(),
  daysStockedCategoryChanged: optInt(),
  daysStockedGroup: optInt(),

  dealerCertified: optBool(),

  deliveryKilometers: optInt(),
  driverContactNo: optStr(50),
  driverName: optStr(150),

  fleetContractNo: optStr(100),
  fleetController: optStr(150),

  fullServiceHistory: optBool(),
  importedVehicle: optBool(),

  // MV
  mvCertificationDate: optDate(),
  mvCertificationNumber: optStr(100),
  mvRegistrationDate: optDate(),
  mvRegistrationNumber: optStr(100),

  comments: z.string().nullish(),
  previousOwners: optInt(),

  // Rental
  rentalContract: optStr(100),
  rentalStartDatetime: optDatetime(),
  rentalEndDatetime: optDatetime(),
  rentalItemCategory: optStr(100),

  reservedFor: optStr(150),
  reservedForBy: optStr(150),

  // Telematics
  telematicsId: optStr(100),
  telematicsAssetId: optStr(100),
  telematicsLocation: optStr(150),
  telematicsService: optStr(150),

  // Warranty
  warrantyAcceptanceCert: optBool(),
  warrantyAcceptanceCertDate: optDate(),
  warrantyActive: optBool(),
  warrantyNumber: optStr(100),
  warrantyStartDate: optDate(),

  // Keys
  keyNumber: optStr(100),
  keyNumber2: optStr(100),

  batteryVoltage: optNumeric(),

  dateBuilt: optDate(),
  dateFirstSold: optDate(),

  drive: optStr(100),
  eTagNumber: optStr(100),

  grossVehicleMass: optNumeric(),
  immobiliserNumber: optStr(100),

  inServiceKilometers: optInt(),

  noOfCylinders: optInt(),
  noOfDoors: optInt(),
  noOfPassengers: optInt(),
  noOfAxles: optInt(),

  odoType: optStr(50),
  oemWarrantyEnd: optDate(),

  provinceRegistered: optStr(100),
  radioPin: optStr(100),

  sellingDealerCode: optStr(100),
  serviceKey: optStr(100),

  traderId: optStr(100),
  traderReference: optStr(100),

  unladenWeight: optNumeric(),
  vehicleTrim: optStr(150),
});

// ─── Update Vehicle ───────────────────────────────────────────────────────────
export const updateVehicleSchema = z
  .object({
    brand: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(100).optional(),
    modelVariant: optStr(150),
    manufacturingYear: z.number().int().min(1900).max(2100).optional(),
    odometerLast: z.number().int().min(0).optional(),
    status: z.enum(VEHICLE_STATUSES).optional(),
    priority: z.enum(VEHICLE_PRIORITIES).optional(),
    serviceType: z.string().min(1).max(50).optional(),

    customerId: optUuid(),
    dealerId: optUuid(),

    oemModel: optStr(100),
    engineNumber: optStr(100),
    registrationNumber: optStr(50).transform((v) => (v ? v.trim().toUpperCase() : v)),

    extColour: optStr(100),
    intColour: optStr(100),

    fuelType: optStr(50),
    transmissionType: optStr(50),

    deliveryDate: optDate(),

    vehStockNo: optStr(100),
    vehGlobalStockNo: optStr(100),
    factoryJobNo: optStr(100),

    seriesDescription: optStr(150),
    modelDescription: optStr(150),
    modelCode: optStr(50),

    registrationDate: optDate(),
    registrationYear: z.number().int().min(1900).max(2100).optional().nullable(),
    defaultTaxCode: optStr(50),
    purchaseTranCode: optStr(50),
    dateStocked: optDate(),

    condition: optStr(100),
    vehicleLocation: optStr(150),

    nscNumber: optStr(100),
    microdotNumber: optStr(100),
    mmCode: optStr(100),

    passengerCommercial: z.string().length(1).nullish(),

    bodyType: optStr(100),
    engineCapacity: optInt(),

    totalInvoiceCostExcl: optNumeric(),
    lessAdvertisingExp: optNumeric(),
    lessHoldback: optNumeric(),
    estimatedReconditioning: optNumeric(),
    retailPrice: optNumeric(),
    totalMsrp: optNumeric(),
    addendumAmount: optNumeric(),
    currentPrice: optNumeric(),
    depreciationPerc: optNumeric(),
    bookRetailAmount: optNumeric(),
    bookTradeAmount: optNumeric(),

    availableForResale: optBool(),
    certificationNo: optStr(100),
    certifiedPreOwned: optBool(),

    daysStockedAtLocation: optInt(),
    daysStockedBranch: optInt(),
    daysStockedCategoryChanged: optInt(),
    daysStockedGroup: optInt(),

    dealerCertified: optBool(),

    deliveryKilometers: optInt(),
    driverContactNo: optStr(50),
    driverName: optStr(150),

    fleetContractNo: optStr(100),
    fleetController: optStr(150),

    fullServiceHistory: optBool(),
    importedVehicle: optBool(),

    mvCertificationDate: optDate(),
    mvCertificationNumber: optStr(100),
    mvRegistrationDate: optDate(),
    mvRegistrationNumber: optStr(100),

    comments: z.string().nullish(),
    previousOwners: optInt(),

    rentalContract: optStr(100),
    rentalStartDatetime: optDatetime(),
    rentalEndDatetime: optDatetime(),
    rentalItemCategory: optStr(100),

    reservedFor: optStr(150),
    reservedForBy: optStr(150),

    telematicsId: optStr(100),
    telematicsAssetId: optStr(100),
    telematicsLocation: optStr(150),
    telematicsService: optStr(150),

    warrantyAcceptanceCert: optBool(),
    warrantyAcceptanceCertDate: optDate(),
    warrantyActive: optBool(),
    warrantyNumber: optStr(100),
    warrantyStartDate: optDate(),

    keyNumber: optStr(100),
    keyNumber2: optStr(100),

    batteryVoltage: optNumeric(),

    dateBuilt: optDate(),
    dateFirstSold: optDate(),

    drive: optStr(100),
    eTagNumber: optStr(100),

    grossVehicleMass: optNumeric(),
    immobiliserNumber: optStr(100),

    inServiceKilometers: optInt(),

    noOfCylinders: optInt(),
    noOfDoors: optInt(),
    noOfPassengers: optInt(),
    noOfAxles: optInt(),

    odoType: optStr(50),
    oemWarrantyEnd: optDate(),

    provinceRegistered: optStr(100),
    radioPin: optStr(100),

    sellingDealerCode: optStr(100),
    serviceKey: optStr(100),

    traderId: optStr(100),
    traderReference: optStr(100),

    unladenWeight: optNumeric(),
    vehicleTrim: optStr(150),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided to update',
  });

// ─── Query / Param Schemas ────────────────────────────────────────────────────
export const vehicleListQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/, 'Page must be a number')
    .transform(Number)
    .default('1'),
  limit: z
    .string()
    .regex(/^\d+$/, 'Limit must be a number')
    .transform(Number)
    .default('10'),
  status: z.enum(VEHICLE_STATUSES).optional(),
  // PENDING / COMPLETED are the current tab values; INSIDE / PENDING_EXIT are
  // their former names, kept valid for older clients and bookmarked URLs.
  filter: z.enum(['ALL', 'PENDING', 'COMPLETED', 'INSIDE', 'PENDING_EXIT']).optional(),
  dateFrom: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: 'dateFrom must be in YYYY-MM-DD format (e.g. 2026-02-19)',
    }),
  dateTo: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: 'dateTo must be in YYYY-MM-DD format (e.g. 2026-02-19)',
    }),
  vin: z.string().optional(),
  customerId: z.string().uuid().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeAll: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export const vehicleIdParamSchema = z.object({
  id: z.string().uuid('Invalid vehicle ID format'),
});

export const vehicleSearchQuerySchema = z.object({
  vin: z.string().min(1, 'VIN is required'),
});

// ─── Makes & Models ──────────────────────────────────────────────────────────
export const addMakeSchema = z.object({
  name: z.string({ required_error: 'Make name is required' }).min(1).max(100),
});

export const addModelSchema = z.object({
  makeId: z.string({ required_error: 'Make ID is required' }).uuid(),
  name: z.string({ required_error: 'Model name is required' }).min(1).max(100),
});

export const makeIdParamSchema = z.object({
  makeId: z.string().uuid('Invalid make ID format'),
});

export type AddVehicleInput = z.infer<typeof addVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type VehicleListQuery = z.infer<typeof vehicleListQuerySchema>;
export type VehicleIdParam = z.infer<typeof vehicleIdParamSchema>;
