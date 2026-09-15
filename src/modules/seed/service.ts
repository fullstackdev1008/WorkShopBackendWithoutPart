import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { serverError } from '../../shared/http/response';
import {
  roles,
  users,
  permissions,
  serviceTypes,
  slotConfigurations,
  qcChecklistTemplates,
  complaints,
  partsMaster,
  vehicleMakes,
  vehicleModels,
  modelServiceTypeAssignments,
} from '../../db/models';

// ─── Roles ───────────────────────────────────────────────────────────────────

const DEFAULT_ROLES = [
  { name: 'Super Admin',          slug: 'super-admin' },
  { name: 'QC Inspector',         slug: 'qc-inspector' },
  { name: 'Security Gate Keeper', slug: 'security-gate-keeper' },
  { name: 'Customer',             slug: 'customer' },
  { name: 'Service Advisor',      slug: 'service-advisor' },
  { name: 'Parts Manager',        slug: 'parts-manager' },
  { name: 'Receptionist',         slug: 'receptionist' },
];

// ─── Users ───────────────────────────────────────────────────────────────────

const DEFAULT_USERS = [
  { username: 'super_admin',    email: 'admin@workshop.com',         password: 'password123', roleSlug: 'super-admin' },
  { username: 'qc_inspector',   email: 'qc@workshop.com',            password: 'password123', roleSlug: 'qc-inspector' },
  { username: 'gate_keeper',    email: 'gatekeeper@workshop.com',    password: 'password123', roleSlug: 'security-gate-keeper' },
  { username: 'service_advisor',email: 'advisor@workshop.com',       password: 'password123', roleSlug: 'service-advisor' },
  { username: 'parts_manager',  email: 'partsmanager@workshop.com',  password: 'password123', roleSlug: 'parts-manager' },
  { username: 'receptionist',   email: 'receptionist@workshop.com',  password: 'password123', roleSlug: 'receptionist' },
];

// ─── Permissions ──────────────────────────────────────────────────────────────

const DEFAULT_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  'super-admin': [
    { resource: 'GATE_ENTRY',       action: 'view' },
    { resource: 'QC_INSPECTION',    action: 'view' },
    { resource: 'JOB_CARD',         action: 'view' },
    { resource: 'PARTS_MANAGER',    action: 'view' },
    { resource: 'ROLE_MANAGEMENT',  action: 'view' },
    { resource: 'USER_MANAGEMENT',  action: 'view' },
    { resource: 'vehicles',         action: 'read' },
    { resource: 'vehicles',         action: 'create' },
    { resource: 'vehicles',         action: 'update' },
    { resource: 'vehicles',         action: 'delete' },
    { resource: 'vehicle-images',   action: 'create' },
    { resource: 'vehicle-images',   action: 'update' },
    { resource: 'vehicle-images',   action: 'delete' },
    { resource: 'vehicle-accessories', action: 'read' },
    { resource: 'vehicle-accessories', action: 'create' },
    { resource: 'vehicle-accessories', action: 'update' },
    { resource: 'vehicle-accessories', action: 'delete' },
    { resource: 'check-ins',        action: 'read' },
    { resource: 'check-ins',        action: 'create' },
    { resource: 'check-ins',        action: 'update' },
    { resource: 'check-ins',        action: 'delete' },
    { resource: 'confirm-entry',    action: 'create' },
    { resource: 'customers',        action: 'read' },
    { resource: 'customers',        action: 'create' },
    { resource: 'customers',        action: 'update' },
    { resource: 'customers',        action: 'delete' },
    { resource: 'qc-inspections',   action: 'read' },
    { resource: 'qc-inspections',   action: 'create' },
    { resource: 'qc-inspections',   action: 'update' },
    { resource: 'qc-inspections',   action: 'delete' },
    { resource: 'service-advisor',  action: 'read' },
    { resource: 'service-advisor',  action: 'create' },
    { resource: 'service-advisor',  action: 'update' },
    { resource: 'service-advisor',  action: 'delete' },
    { resource: 'parts-manager',    action: 'read' },
    { resource: 'parts-manager',    action: 'create' },
    { resource: 'parts-manager',    action: 'update' },
  ],
  'qc-inspector': [
    { resource: 'QC_INSPECTION',  action: 'view' },
    { resource: 'qc-inspections', action: 'read' },
    { resource: 'qc-inspections', action: 'create' },
    { resource: 'qc-inspections', action: 'update' },
    { resource: 'qc-inspections', action: 'delete' },
  ],
  'security-gate-keeper': [
    { resource: 'GATE_ENTRY',          action: 'view' },
    { resource: 'vehicles',            action: 'read' },
    { resource: 'vehicles',            action: 'create' },
    { resource: 'vehicles',            action: 'update' },
    { resource: 'vehicles',            action: 'delete' },
    { resource: 'vehicle-images',      action: 'create' },
    { resource: 'vehicle-images',      action: 'update' },
    { resource: 'vehicle-images',      action: 'delete' },
    { resource: 'vehicle-accessories', action: 'read' },
    { resource: 'vehicle-accessories', action: 'create' },
    { resource: 'vehicle-accessories', action: 'update' },
    { resource: 'vehicle-accessories', action: 'delete' },
    { resource: 'check-ins',           action: 'read' },
    { resource: 'check-ins',           action: 'create' },
    { resource: 'check-ins',           action: 'update' },
    { resource: 'check-ins',           action: 'delete' },
    { resource: 'confirm-entry',       action: 'create' },
    { resource: 'customers',           action: 'read' },
    { resource: 'customers',           action: 'create' },
    { resource: 'customers',           action: 'update' },
    { resource: 'customers',           action: 'delete' },
  ],
  'service-advisor': [
    { resource: 'JOB_CARD',        action: 'view' },
    { resource: 'service-advisor', action: 'read' },
    { resource: 'service-advisor', action: 'create' },
    { resource: 'service-advisor', action: 'update' },
    { resource: 'service-advisor', action: 'delete' },
  ],
  'parts-manager': [
    { resource: 'PARTS_MANAGER',  action: 'view' },
    { resource: 'parts-manager',  action: 'read' },
    { resource: 'parts-manager',  action: 'create' },
    { resource: 'parts-manager',  action: 'update' },
  ],
  'receptionist': [
    { resource: 'APPOINTMENT', action: 'view' },
    { resource: 'APPOINTMENT', action: 'create' },
    { resource: 'APPOINTMENT', action: 'edit' },
  ],
  'customer': [
    { resource: 'customers',       action: 'read' },
    { resource: 'customers',       action: 'create' },
    { resource: 'customers',       action: 'update' },
    { resource: 'service-advisor', action: 'read' },
    { resource: 'service-advisor', action: 'create' },
    { resource: 'service-advisor', action: 'update' },
  ],
};

// ─── Service Types ────────────────────────────────────────────────────────────

const DEFAULT_SERVICE_TYPES = [
  // Service tiers (service_assignment)
  { code: 'AMC_SERVICE',       name: 'AMC Service',       emoji: '🔧', category: 'service_assignment', estimatedDurationMinutes: 180 },
  { code: 'REPAIR',            name: 'Repair',            emoji: '🔧', category: 'service_assignment', estimatedDurationMinutes: 180 },
  { code: 'SCHEDULED_SERVICE', name: 'Scheduled Service', emoji: '🔧', category: 'service_assignment', estimatedDurationMinutes: 180 },
  { code: 'WARRANTY_SERVICE',  name: 'Warranty Service',  emoji: '📋', category: 'service_assignment', estimatedDurationMinutes: 240 },
  // Repair / inspection domains (service_category)
  // B/C/D scheduled-service tiers — selected as a "Service Category" (model→part
  // assignments are mapped against these); must NOT be 'service_assignment' or
  // they leak into the Service Type list.
  { code: 'B_SERVICE',     name: 'B Service',     emoji: '🔧', category: 'service_category',   estimatedDurationMinutes: 180 },
  { code: 'C_SERVICE',     name: 'C Service',     emoji: '🔧', category: 'service_category',   estimatedDurationMinutes: 240 },
  { code: 'D_SERVICE',     name: 'D Service',     emoji: '🔧', category: 'service_category',   estimatedDurationMinutes: 300 },
  { code: 'BRAKE_SERVICE', name: 'Brake Service', emoji: '🛑', category: 'service_category',   estimatedDurationMinutes: 120 },
  { code: 'TYRE_SERVICE',  name: 'Tyre Service',  emoji: '🔄', category: 'service_category',   estimatedDurationMinutes: 60  },
  { code: 'ELECTRICAL',    name: 'Electrical',    emoji: '⚡', category: 'service_category',   estimatedDurationMinutes: 180 },
  { code: 'BODY_REPAIR',   name: 'Body Repair',   emoji: '🔨', category: 'service_category',   estimatedDurationMinutes: 480 },
  { code: 'INSPECTION',    name: 'Inspection',    emoji: '🔍', category: 'service_category',   estimatedDurationMinutes: 60  },
  { code: 'DIAGNOSTICS',   name: 'Diagnostics',   emoji: '💻', category: 'service_category',   estimatedDurationMinutes: 90  },
  { code: 'OTHER',         name: 'Other',         emoji: '⚙️', category: 'service_category',   estimatedDurationMinutes: 120 },
];

// ─── Slot Configurations ─────────────────────────────────────────────────────

const DEFAULT_SLOTS = [
  { time: '07:00', capacity: 3 },
  { time: '08:00', capacity: 3 },
  { time: '09:00', capacity: 3 },
  { time: '10:00', capacity: 3 },
  { time: '11:00', capacity: 3 },
  { time: '12:00', capacity: 2 },
  { time: '13:00', capacity: 3 },
  { time: '14:00', capacity: 3 },
  { time: '15:00', capacity: 3 },
  { time: '16:00', capacity: 3 },
  { time: '17:00', capacity: 2 },
];

// ─── QC Checklist Templates ──────────────────────────────────────────────────

const DEFAULT_QC_CHECKLIST = [
  // EXTERIOR
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-001', itemLabel: 'Front Bumper Condition',      sortOrder: 1 },
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-002', itemLabel: 'Rear Bumper Condition',       sortOrder: 2 },
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-003', itemLabel: 'Hood / Bonnet',               sortOrder: 3 },
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-004', itemLabel: 'Roof Panel',                  sortOrder: 4 },
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-005', itemLabel: 'Left Door Panel',             sortOrder: 5 },
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-006', itemLabel: 'Right Door Panel',            sortOrder: 6 },
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-007', itemLabel: 'Left Side Mirror',            sortOrder: 7 },
  { category: 'EXTERIOR', subCategory: 'Body',    itemCode: 'EXT-008', itemLabel: 'Right Side Mirror',           sortOrder: 8 },
  { category: 'EXTERIOR', subCategory: 'Glass',   itemCode: 'EXT-009', itemLabel: 'Windshield (Front)',          sortOrder: 9 },
  { category: 'EXTERIOR', subCategory: 'Glass',   itemCode: 'EXT-010', itemLabel: 'Rear Windshield',             sortOrder: 10 },
  { category: 'EXTERIOR', subCategory: 'Glass',   itemCode: 'EXT-011', itemLabel: 'Left Window Glass',           sortOrder: 11 },
  { category: 'EXTERIOR', subCategory: 'Glass',   itemCode: 'EXT-012', itemLabel: 'Right Window Glass',          sortOrder: 12 },
  { category: 'EXTERIOR', subCategory: 'Lights',  itemCode: 'EXT-013', itemLabel: 'Headlights (Front)',          sortOrder: 13 },
  { category: 'EXTERIOR', subCategory: 'Lights',  itemCode: 'EXT-014', itemLabel: 'Tail Lights (Rear)',          sortOrder: 14 },
  { category: 'EXTERIOR', subCategory: 'Lights',  itemCode: 'EXT-015', itemLabel: 'Indicator / Turn Signals',   sortOrder: 15 },
  { category: 'EXTERIOR', subCategory: 'Tyres',   itemCode: 'EXT-016', itemLabel: 'Left Front Tyre',            sortOrder: 16 },
  { category: 'EXTERIOR', subCategory: 'Tyres',   itemCode: 'EXT-017', itemLabel: 'Right Front Tyre',           sortOrder: 17 },
  { category: 'EXTERIOR', subCategory: 'Tyres',   itemCode: 'EXT-018', itemLabel: 'Left Rear Tyre(s)',          sortOrder: 18 },
  { category: 'EXTERIOR', subCategory: 'Tyres',   itemCode: 'EXT-019', itemLabel: 'Right Rear Tyre(s)',         sortOrder: 19 },
  { category: 'EXTERIOR', subCategory: 'Tyres',   itemCode: 'EXT-020', itemLabel: 'Spare Tyre Condition',       sortOrder: 20 },
  { category: 'EXTERIOR', subCategory: 'Chassis', itemCode: 'EXT-021', itemLabel: 'Frame / Chassis Condition',  sortOrder: 21 },
  { category: 'EXTERIOR', subCategory: 'Chassis', itemCode: 'EXT-022', itemLabel: 'Exhaust System',             sortOrder: 22 },
  { category: 'EXTERIOR', subCategory: 'Chassis', itemCode: 'EXT-023', itemLabel: 'Fuel Tank & Cap',            sortOrder: 23 },

  // INTERIOR
  { category: 'INTERIOR', subCategory: 'Cabin',        itemCode: 'INT-001', itemLabel: 'Driver Seat Condition',       sortOrder: 1 },
  { category: 'INTERIOR', subCategory: 'Cabin',        itemCode: 'INT-002', itemLabel: 'Passenger Seat Condition',    sortOrder: 2 },
  { category: 'INTERIOR', subCategory: 'Cabin',        itemCode: 'INT-003', itemLabel: 'Dashboard Condition',         sortOrder: 3 },
  { category: 'INTERIOR', subCategory: 'Cabin',        itemCode: 'INT-004', itemLabel: 'Steering Wheel',              sortOrder: 4 },
  { category: 'INTERIOR', subCategory: 'Cabin',        itemCode: 'INT-005', itemLabel: 'Horn',                        sortOrder: 5 },
  { category: 'INTERIOR', subCategory: 'Cabin',        itemCode: 'INT-006', itemLabel: 'Seat Belts (All)',            sortOrder: 6 },
  { category: 'INTERIOR', subCategory: 'Electrical',   itemCode: 'INT-007', itemLabel: 'Air Conditioning',            sortOrder: 7 },
  { category: 'INTERIOR', subCategory: 'Electrical',   itemCode: 'INT-008', itemLabel: 'Heater / Fan',                sortOrder: 8 },
  { category: 'INTERIOR', subCategory: 'Electrical',   itemCode: 'INT-009', itemLabel: 'Instrument Cluster / Gauges', sortOrder: 9 },
  { category: 'INTERIOR', subCategory: 'Electrical',   itemCode: 'INT-010', itemLabel: 'Interior Lights',             sortOrder: 10 },
  { category: 'INTERIOR', subCategory: 'Electrical',   itemCode: 'INT-011', itemLabel: 'Radio / Multimedia',          sortOrder: 11 },
  { category: 'INTERIOR', subCategory: 'Electrical',   itemCode: 'INT-012', itemLabel: 'Power Windows',               sortOrder: 12 },
  { category: 'INTERIOR', subCategory: 'Engine',       itemCode: 'INT-013', itemLabel: 'Engine Oil Level',            sortOrder: 13 },
  { category: 'INTERIOR', subCategory: 'Engine',       itemCode: 'INT-014', itemLabel: 'Coolant Level',               sortOrder: 14 },
  { category: 'INTERIOR', subCategory: 'Engine',       itemCode: 'INT-015', itemLabel: 'Brake Fluid Level',           sortOrder: 15 },
  { category: 'INTERIOR', subCategory: 'Engine',       itemCode: 'INT-016', itemLabel: 'Power Steering Fluid',        sortOrder: 16 },
  { category: 'INTERIOR', subCategory: 'Engine',       itemCode: 'INT-017', itemLabel: 'Windshield Washer Fluid',     sortOrder: 17 },
  { category: 'INTERIOR', subCategory: 'Engine',       itemCode: 'INT-018', itemLabel: 'Battery Condition',           sortOrder: 18 },
  { category: 'INTERIOR', subCategory: 'Engine',       itemCode: 'INT-019', itemLabel: 'Air Filter Condition',        sortOrder: 19 },
  { category: 'INTERIOR', subCategory: 'Transmission', itemCode: 'INT-020', itemLabel: 'Transmission Fluid',          sortOrder: 20 },
  { category: 'INTERIOR', subCategory: 'Transmission', itemCode: 'INT-021', itemLabel: 'Clutch Pedal Operation',      sortOrder: 21 },

  // BRAKE
  { category: 'BRAKE', subCategory: 'Front Brakes', itemCode: 'BRK-001', itemLabel: 'Front Brake Pad Thickness',    sortOrder: 1 },
  { category: 'BRAKE', subCategory: 'Front Brakes', itemCode: 'BRK-002', itemLabel: 'Front Rotor / Disc Condition', sortOrder: 2 },
  { category: 'BRAKE', subCategory: 'Front Brakes', itemCode: 'BRK-003', itemLabel: 'Front Caliper Condition',      sortOrder: 3 },
  { category: 'BRAKE', subCategory: 'Front Brakes', itemCode: 'BRK-004', itemLabel: 'Front Brake Hose / Lines',     sortOrder: 4 },
  { category: 'BRAKE', subCategory: 'Rear Brakes',  itemCode: 'BRK-005', itemLabel: 'Rear Brake Pad / Shoe',        sortOrder: 5 },
  { category: 'BRAKE', subCategory: 'Rear Brakes',  itemCode: 'BRK-006', itemLabel: 'Rear Rotor / Drum Condition',  sortOrder: 6 },
  { category: 'BRAKE', subCategory: 'Rear Brakes',  itemCode: 'BRK-007', itemLabel: 'Rear Caliper Condition',       sortOrder: 7 },
  { category: 'BRAKE', subCategory: 'Rear Brakes',  itemCode: 'BRK-008', itemLabel: 'Rear Brake Hose / Lines',      sortOrder: 8 },
  { category: 'BRAKE', subCategory: 'System',       itemCode: 'BRK-009', itemLabel: 'Brake Pedal Travel / Feel',    sortOrder: 9 },
  { category: 'BRAKE', subCategory: 'System',       itemCode: 'BRK-010', itemLabel: 'Handbrake / Parking Brake',    sortOrder: 10 },
  { category: 'BRAKE', subCategory: 'System',       itemCode: 'BRK-011', itemLabel: 'ABS Warning Light',            sortOrder: 11 },
  { category: 'BRAKE', subCategory: 'System',       itemCode: 'BRK-012', itemLabel: 'Brake Fluid Leaks',            sortOrder: 12 },
];

// ─── Complaints ──────────────────────────────────────────────────────────────

const DEFAULT_COMPLAINTS = [
  'Engine not starting',
  'Engine overheating',
  'Oil leak',
  'Coolant leak',
  'Strange engine noise',
  'Engine vibration',
  'Excessive smoke',
  'Brake noise (squealing / grinding)',
  'Brake feels spongy',
  'Handbrake not holding',
  'ABS warning light on',
  'Steering pulling to one side',
  'Heavy steering',
  'Suspension noise',
  'Tyre wear uneven',
  'Flat tyre',
  'Air conditioning not cooling',
  'Heater not working',
  'Battery / electrical issue',
  'Warning light on dashboard',
  'Fuel consumption high',
  'Transmission slipping',
  'Gearbox noise',
  'Clutch slipping',
  'Windshield crack / chip',
  'Wipers not working',
  'Horn not working',
  'Body dent / scratch',
  'Rust / corrosion',
  'Scheduled service due',
];

// ─── Parts Master ─────────────────────────────────────────────────────────────

const DEFAULT_PARTS = [
  { partCode: 'LABOUR',            partName: 'LABOUR',                          defaultPrice: '650.00' },
  { partCode: 'SARL3511AA039',     partName: 'AIR DRIER FILTER ELEMENT',        defaultPrice: '263.93' },
  { partCode: '11090702000C00',    partName: 'AIR FILTER ELEMENT INNER / PRI',  defaultPrice: '449.76' },
  { partCode: '11090602000C00',    partName: 'AIR FILTER ELEMENT OUTER / SEC',  defaultPrice: '1424.76' },
  { partCode: 'PT3406',            partName: 'ENGINE OIL DIESEL',               defaultPrice: '95.90' },
  { partCode: '1117050M002060AA',  partName: 'FUEL FILTER DIESEL',              defaultPrice: '533.69' },
  { partCode: '1012010M18054W',    partName: 'OIL FILTER',                      defaultPrice: '397.62' },
  { partCode: '101701529DM',       partName: 'OIL FILTER SPINNER/ROTARY TYPE',  defaultPrice: '582.99' },
  { partCode: '9971239',           partName: 'SHOP SUPPLIES',                   defaultPrice: '300.00' },
  { partCode: 'U00153',            partName: 'GREASE CHASSIS',                  defaultPrice: '195.69' },
  { partCode: '11050502007',       partName: 'FUEL FILTER DIESEL WATER TRAP',   defaultPrice: '1352.85' },
  { partCode: '8113010B45C00',     partName: 'AIR CONDITIONER DUST FILTER',     defaultPrice: '365.46' },
  { partCode: 'P00345',            partName: 'ANTI FREEZE',                     defaultPrice: '72.05' },
  { partCode: '1023022M5002000',   partName: 'V-BELT ALTERNATOR',               defaultPrice: '704.27' },
  { partCode: '1023021M5002000',   partName: 'V-BELT AIR CONDITIONER',          defaultPrice: '489.69' },
  { partCode: 'P05201',            partName: 'POWERSTEERING OIL / FLUID',       defaultPrice: '75.38' },
  { partCode: '3408015716',        partName: 'POWERSTEERING OIL FILTER',        defaultPrice: '134.20' },
  { partCode: '0009971239',        partName: 'SHOP SUPPLIES (ALT)',              defaultPrice: '300.00' },
  { partCode: 'GT5905',            partName: 'TRANSMISSION FLUID 1 LITRE',      defaultPrice: '283.36' },
  { partCode: '1017010AM500000',   partName: 'OIL FILTER (BYPASS)',             defaultPrice: '1999.88' },
  { partCode: 'GT4645',            partName: 'DIFF OIL REAR',                   defaultPrice: '64.74' },
  { partCode: 'PT6621',            partName: 'BRAKE FLUID',                     defaultPrice: '114.75' },
  { partCode: '1530002741',        partName: 'RETARDER OIL FILTER',             defaultPrice: '3727.27' },
  { partCode: '1117050M002060A',   partName: 'FUEL FILTER DIESEL (ALT)',        defaultPrice: '533.69' },
];

// ─── Vehicle Makes / Models ───────────────────────────────────────────────────

const DEFAULT_VEHICLE_MAKES = [
  { name: 'FAW', code: 'FAW' },
];

const DEFAULT_VEHICLE_MODELS: Record<string, string[]> = {
  FAW: ['J6 500', 'J6 350', 'J5', 'Tiger V'],
};

// ─── B / C / D Service Parts for FAW J6 500 ──────────────────────────────────

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

// ─── Seed Runner ─────────────────────────────────────────────────────────────

export async function runSeed() {
  try {
    const report: Record<string, { created: number; skipped: number }> = {};

    const track = (key: string) => {
      if (!report[key]) report[key] = { created: 0, skipped: 0 };
      return {
        created: () => { report[key].created++; },
        skipped: () => { report[key].skipped++; },
      };
    };

    // 1. Roles
    const roleMap = new Map<string, string>();
    for (const role of DEFAULT_ROLES) {
      const t = track('roles');
      const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.slug, role.slug)).limit(1);
      if (existing) {
        roleMap.set(role.slug, existing.id);
        t.skipped();
      } else {
        const [created] = await db.insert(roles).values({ name: role.name, slug: role.slug }).returning({ id: roles.id });
        roleMap.set(role.slug, created.id);
        t.created();
      }
    }

    // 2. Users
    for (const user of DEFAULT_USERS) {
      const t = track('users');
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, user.email)).limit(1);
      if (existing) { t.skipped(); continue; }
      const roleId = roleMap.get(user.roleSlug);
      if (!roleId) { t.skipped(); continue; }
      const hashedPassword = await bcrypt.hash(user.password, 12);
      await db.insert(users).values({ username: user.username, email: user.email, password: hashedPassword, roleId });
      t.created();
    }

    // 3. Permissions
    for (const [roleSlug, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
      const roleId = roleMap.get(roleSlug);
      if (!roleId) continue;
      for (const perm of perms) {
        const t = track('permissions');
        const result = await db
          .insert(permissions)
          .values({ roleId, resource: perm.resource, action: perm.action })
          .onConflictDoNothing()
          .returning({ id: permissions.id });
        result.length ? t.created() : t.skipped();
      }
    }

    // 4. Service Types
    for (const st of DEFAULT_SERVICE_TYPES) {
      const t = track('serviceTypes');
      const result = await db
        .insert(serviceTypes)
        .values({ code: st.code, name: st.name, emoji: st.emoji, category: st.category, estimatedDurationMinutes: st.estimatedDurationMinutes })
        .onConflictDoUpdate({
          target: serviceTypes.code,
          set: {
            name: st.name,
            emoji: st.emoji,
            category: st.category,
            estimatedDurationMinutes: st.estimatedDurationMinutes,
            updatedAt: new Date(),
          },
        })
        .returning({ id: serviceTypes.id });
      result.length ? t.created() : t.skipped();
    }

    // 5. Slot Configurations
    for (const slot of DEFAULT_SLOTS) {
      const t = track('slotConfigurations');
      const result = await db
        .insert(slotConfigurations)
        .values({ time: slot.time, capacity: slot.capacity })
        .onConflictDoNothing()
        .returning({ id: slotConfigurations.id });
      result.length ? t.created() : t.skipped();
    }

    // 6. QC Checklist Templates
    for (const item of DEFAULT_QC_CHECKLIST) {
      const t = track('qcChecklistTemplates');
      const result = await db
        .insert(qcChecklistTemplates)
        .values({ category: item.category, subCategory: item.subCategory, itemCode: item.itemCode, itemLabel: item.itemLabel, sortOrder: item.sortOrder })
        .onConflictDoNothing()
        .returning({ id: qcChecklistTemplates.id });
      result.length ? t.created() : t.skipped();
    }

    // 7. Complaints
    for (const name of DEFAULT_COMPLAINTS) {
      const t = track('complaints');
      const result = await db
        .insert(complaints)
        .values({ name })
        .onConflictDoNothing()
        .returning({ id: complaints.id });
      result.length ? t.created() : t.skipped();
    }

    // 8. Parts Master
    for (const part of DEFAULT_PARTS) {
      const t = track('partsMaster');
      const result = await db
        .insert(partsMaster)
        .values({ partCode: part.partCode, partName: part.partName, defaultPrice: part.defaultPrice })
        .onConflictDoUpdate({
          target: partsMaster.partCode,
          set: { partName: part.partName, defaultPrice: part.defaultPrice, updatedAt: new Date() },
        })
        .returning({ id: partsMaster.id });
      result.length ? t.created() : t.skipped();
    }

    // 9. Vehicle Makes
    const makeMap = new Map<string, string>();
    for (const make of DEFAULT_VEHICLE_MAKES) {
      const t = track('vehicleMakes');
      const [existing] = await db.select({ id: vehicleMakes.id }).from(vehicleMakes).where(eq(vehicleMakes.name, make.name)).limit(1);
      if (existing) {
        makeMap.set(make.name, existing.id);
        t.skipped();
      } else {
        const [created] = await db.insert(vehicleMakes).values({ name: make.name, code: make.code }).returning({ id: vehicleMakes.id });
        makeMap.set(make.name, created.id);
        t.created();
      }
    }

    // 10. Vehicle Models
    for (const [makeName, modelNames] of Object.entries(DEFAULT_VEHICLE_MODELS)) {
      const makeId = makeMap.get(makeName);
      if (!makeId) continue;
      for (const modelName of modelNames) {
        const t = track('vehicleModels');
        const [existing] = await db
          .select({ id: vehicleModels.id })
          .from(vehicleModels)
          .where(and(eq(vehicleModels.makeId, makeId), eq(vehicleModels.name, modelName)))
          .limit(1);
        if (existing) { t.skipped(); continue; }
        await db.insert(vehicleModels).values({ makeId, name: modelName });
        t.created();
      }
    }

    // 11. Service Type Assignments (B/C/D for FAW J6 500)
    const fawMakeId = makeMap.get('FAW');
    if (fawMakeId) {
      const [j6Model] = await db
        .select({ id: vehicleModels.id })
        .from(vehicleModels)
        .where(and(eq(vehicleModels.makeId, fawMakeId), eq(vehicleModels.name, 'J6 500')))
        .limit(1);

      if (j6Model) {
        const stMap: Record<string, string> = {};
        for (const code of ['B_SERVICE', 'C_SERVICE', 'D_SERVICE']) {
          const [st] = await db.select({ id: serviceTypes.id }).from(serviceTypes).where(eq(serviceTypes.code, code)).limit(1);
          if (st) stMap[code] = st.id;
        }

        const insertAssignments = async (serviceCode: string, parts: typeof B_SERVICE_PARTS) => {
          const serviceTypeId = stMap[serviceCode];
          if (!serviceTypeId) return;
          const existing = await db
            .select({ id: modelServiceTypeAssignments.id })
            .from(modelServiceTypeAssignments)
            .where(and(
              eq(modelServiceTypeAssignments.makeId, fawMakeId),
              eq(modelServiceTypeAssignments.modelId, j6Model.id),
              eq(modelServiceTypeAssignments.serviceTypeId, serviceTypeId),
            ));
          if (existing.length > 0) {
            report['serviceAssignments'] = report['serviceAssignments'] || { created: 0, skipped: 0 };
            report['serviceAssignments'].skipped += parts.length;
            return;
          }
          for (const part of parts) {
            await db.insert(modelServiceTypeAssignments).values({
              makeId: fawMakeId,
              modelId: j6Model.id,
              serviceTypeId,
              partCode: part.partCode,
              partName: part.partName,
              quantity: part.quantity,
              unitPrice: part.unitPrice,
            });
            report['serviceAssignments'] = report['serviceAssignments'] || { created: 0, skipped: 0 };
            report['serviceAssignments'].created++;
          }
        };

        await insertAssignments('B_SERVICE', B_SERVICE_PARTS);
        await insertAssignments('C_SERVICE', C_SERVICE_PARTS);
        await insertAssignments('D_SERVICE', D_SERVICE_PARTS);
      }
    }

    return {
      seeded: true,
      summary: report,
      credentials: {
        superAdmin:     { email: 'admin@workshop.com',        password: 'password123' },
        qcInspector:    { email: 'qc@workshop.com',           password: 'password123' },
        gateKeeper:     { email: 'gatekeeper@workshop.com',   password: 'password123' },
        serviceAdvisor: { email: 'advisor@workshop.com',      password: 'password123' },
        partsManager:   { email: 'partsmanager@workshop.com', password: 'password123' },
        receptionist:   { email: 'receptionist@workshop.com', password: 'password123' },
      },
    };
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
