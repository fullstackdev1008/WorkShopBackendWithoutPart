import { pgEnum } from 'drizzle-orm/pg-core';

// ─── QC Enums ────────────────────────────────────────────────────────────────
export const qcInspectionStatusEnum = pgEnum('qc_inspection_status', [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
]);

export const qcItemResultEnum = pgEnum('qc_item_result', [
  'PASS',
  'FAIL',
  'NA',
]);

export const qcCategoryEnum = pgEnum('qc_category', [
  'EXTERIOR',
  'INTERIOR',
  'BRAKE',
]);

export const qcOverallStatusEnum = pgEnum('qc_overall_status', [
  'PASS',
  'CONDITIONAL',
  'FAIL',
]);

// ─── Vehicle Check-In Enums ──────────────────────────────────────────────────
export const vehicleCheckInStatusEnum = pgEnum('vehicle_check_in_status', [
  'IN_QUEUE',
  'IN_SERVICE',
  'READY',
  'COMPLETED',
  'CANCELLED',
]);

export const vehiclePhotoTypeEnum = pgEnum('vehicle_photo_type', [
  'FRONT',
  'REAR',
  'LEFT',
  'RIGHT',
  'DASHBOARD',
  'ENGINE',
  'DAMAGE',
  'OTHER',
]);

export const fuelLevelEnum = pgEnum('fuel_level', [
  'EMPTY',
  'QUARTER',
  'HALF',
  'THREE_QUARTER',
  'FULL',
]);

// Phase 2 — Workshop Allocation
export const workshopPriorityEnum = pgEnum('workshop_priority', [
  'LOW', 'MEDIUM', 'HIGH', 'URGENT',
]);

export const repairCategoryEnum = pgEnum('repair_category', [
  'ENGINE', 'TRANSMISSION', 'ELECTRICAL', 'BRAKES', 'BODY', 'AC', 'OTHER',
]);

// Bay category — classifies a physical workshop bay so the foreman can pick a
// category first and only see bays of that type during allocation.
export const bayCategoryEnum = pgEnum('bay_category', [
  'SERVICE', 'MAJOR', 'PDI',
]);

// (Technician designation is now an admin-managed master table — see
// db/models/designations.ts and users.designationId — not a fixed enum.)

// User shop scope — record-level scoping layer that sits ON TOP of RBAC (never
// replaces it). ALL = unrestricted (default for every existing user and all
// non-shop roles); SERVICE / MAJOR pin a foreman or controller to one shop.
// The record-side counterpart lives on vehicle_check_ins.shop.
export const userShopScopeEnum = pgEnum('user_shop_scope', [
  'SERVICE', 'MAJOR', 'ALL', 'PDI',
]);

// How a job card's customer approval was captured: via the public customer
// link, or accepted in-app by staff (e.g. a warranty clerk acting on the
// customer's behalf). Provenance only — does not change approval semantics.
export const acceptanceChannelEnum = pgEnum('acceptance_channel', [
  'CUSTOMER_LINK', 'STAFF',
]);

// Lifecycle of a job card's (future) Evolve RO sync. DORMANT — only ever
// written by the flag-gated jobCardEvolveSync service, which pushes nothing
// until the UAT blockers clear. NULL on every existing row = "never considered".
// NEEDS_MANUAL is terminal for automatic reconcile: AMBIGUOUS matches and
// permanently-UNRESOLVED job cards (attempt cap reached) land here and are only
// re-queued by an explicit user/system action (picker selection, vehicle edit,
// manual requeue). The reconcile sweep excludes it so it can never auto-retry
// indefinitely.
export const evolveSyncStatusEnum = pgEnum('evolve_sync_status', [
  'PENDING', 'SYNCED', 'FAILED', 'DEFERRED', 'NEEDS_MANUAL',
]);

// Phase 3 — Technician Enhancements
// DIAGNOSIS / REPAIR are the original two; OLD_PART / NEW_PART /
// NEW_PART_FITTED capture the part-replacement story (mandatory whenever
// the item is replacing a physical part).
export const jciPhotoTypeEnum = pgEnum('jci_photo_type', [
  'DIAGNOSIS', 'REPAIR', 'OLD_PART', 'NEW_PART', 'NEW_PART_FITTED',
]);

// Phase 4 — Alerts & Notifications
export const notificationTriggerEnum = pgEnum('notification_trigger', [
  'RO_STATUS', 'APPROVAL', 'LABOUR_80', 'LABOUR_100', 'QC_FAIL',
]);
export const notificationChannelEnum = pgEnum('notification_channel', [
  'WHATSAPP', 'EMAIL', 'INAPP',
]);
export const notificationAudienceEnum = pgEnum('notification_audience', [
  'CUSTOMER', 'TECHNICIAN', 'FOREMAN', 'SA', 'PARTS', 'MANAGER', 'CONTROLLER',
]);
export const notificationLevelEnum = pgEnum('notification_level', ['INFO', 'WARN', 'CRIT']);
export const notificationStatusEnum = pgEnum('notification_status', ['sent', 'failed', 'skipped']);

// Phase 5 — QC Out & Washbay
export const qcOutOverallEnum = pgEnum('qc_out_overall', ['PASS', 'FAIL']);
export const qcOutItemStatusEnum = pgEnum('qc_out_item_status', ['PASS', 'FAIL', 'NA']);

// Phase 6 — Warranty Store
export const warrantyStatusEnum = pgEnum('warranty_status', [
  'HELD', 'PENDING_APPROVAL', 'APPROVED', 'SCRAPPED', 'REJECTED',
]);

// Phase 7 — Invoicing & Release
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT', 'GENERATED', 'PARTIALLY_PAID', 'PAID', 'VOID',
]);
export const paymentModeEnum = pgEnum('payment_mode', [
  'CASH', 'CARD', 'UPI', 'BANK', 'CHEQUE',
]);
export const invoiceLineSourceEnum = pgEnum('invoice_line_source', [
  'JOB_CARD_ITEM', 'ADJUSTMENT',
]);
export const gatePassStatusEnum = pgEnum('gate_pass_status', [
  'ACTIVE', 'REDEEMED', 'VOIDED',
]);

// ─── Job Card Enums ─────────────────────────────────────────────────────────
export const jobCardStatusEnum = pgEnum('job_card_status', [
  'DRAFT',
  'PENDING_PARTS',
  'PARTS_CONFIRMED',
  'SHARED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'MODIFICATION_REQUESTED',
  'IN_PROGRESS',
  'IN_SERVICE',
  'FOREMAN_REVIEW',
  'FOREMAN_REJECTED',
  'COMPLETED',
]);

export const jobCardPriorityEnum = pgEnum('job_card_priority', ['LOW', 'MEDIUM', 'HIGH']);

// ─── Part Request Enum ───────────────────────────────────────────────────────
export const partRequestStatusEnum = pgEnum('part_request_status', [
  'pending',
  'available',
  'unavailable',
  'dispatched',
  'accepted',
  'rejected',
]);

// ─── Appointment Enum ─────────────────────────────────────────────────────────
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_SERVICE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
