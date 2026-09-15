import { FastifyRequest } from 'fastify';
import { and, count, eq, gte, inArray, isNotNull, isNull, lte, or, sql, desc } from 'drizzle-orm';
import { db } from '../../db';
// DORMANT Job Card → Evolve sync. No-op while EVOLVE_JOB_CARD_SYNC_ENABLED=false
// (the default); these calls are fire-and-forget and never block the response.
import { syncJobCardToEvolveRo, syncJobCardUpdateToEvolve } from '../../services/jobCardEvolveSync.service';
import { resolveVehicleCompanyId } from '../../services/vehicleCompany.service';
import {
  vehicles,
  vehicleCheckIns,
  customers,
  customerContacts,
  qcInspections,
  qcInspectionItems,
  qcInspectionPhotos,
  qcConfirmationComponents,
  qcWorkshopRework,
  appointments,
  jobCards,
  jobCardItems,
  vehicleServiceHistory,
  vehicleImages,
  partRequests,
  jobCardItemTimeLogs,
  jobCardItemReassignments,
  jobCardItemPhotos,
  technicianSkills,
  workshopAllocations,
  workshopBays,
  users,
  jobTypes,
  franchiseServiceDepartments,
  jobCardEditHistory,
} from '../../db/models';
import {
  isEstimateAffecting,
  itemsHaveParts,
  resolveEditOutcome,
  isEditLocked,
} from './jobCardEdit';
import { notifyRoleInApp } from '../notifications/service';
import { handleSingleFileUpload, deleteFile } from '../../shared/upload/upload';
import {
  saDashboardQuerySchema,
  vehicleIdParamSchema,
  jobCardIdParamSchema,
  createJobCardSchema,
  updateJobCardSchema,
  updateVehicleStatusSchema,
  addServiceHistorySchema,
} from './dto';
import { resolveItemPrice } from './priceOverride';
import { signUrl } from '../../middleware/s3';
import {
  generateApprovalToken,
  buildApprovalUrl,
  sendWhatsAppEstimate,
} from '../../services/whatsapp.service';
import { sendEstimateEmail } from '../../services/email.service';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import {
  resolveUserScope,
  shopVehicleFilter,
  warrantyVehicleFilter,
  warrantyFilter,
  checkInInScope,
  warrantyInScope,
  WARRANTY_SERVICE_CODE,
  type UserScope,
} from '../../shared/security/scope';

// ─── Status Mapping ─────────────────────────────────────────────────────────
const SA_FILTER_STATUS_MAP: Record<string, string[]> = {
  ALL: ['Inspection Done', 'Job Card (Draft)', 'Job Card (Pending Parts Approval)', 'Job Card (Parts Approval Done)', 'Job Card (Pending Cust. Approval)', 'Job Card (Partial Cust. Approval)', 'Job Card (Full Cust. Approval)', 'In Service', 'Ready for Billing'],
  INSPECTION_DONE: ['Inspection Done'],
  JOB_CARD_DRAFT: ['Job Card (Draft)', 'Job Card (Pending Parts Approval)', 'Job Card (Parts Approval Done)'],
  PENDING_APPROVAL: ['Job Card (Pending Cust. Approval)', 'Job Card (Partial Cust. Approval)', 'Job Card (Full Cust. Approval)'],
  IN_SERVICE: ['In Service'],
  READY_FOR_BILLING: ['Ready for Billing'],
};

// ─── Scope guards (Phase 7 R1) ───────────────────────────────────────────────
// Vehicle-id endpoints: a vehicle is in shop scope iff its ACTIVE check-in is in
// the caller's shop. No-op for ALL / super-admin.
async function vehicleInShopScope(scope: UserScope, vehicleId: string): Promise<boolean> {
  const [ci] = await db
    .select({ shop: vehicleCheckIns.shop })
    .from(vehicleCheckIns)
    .where(and(eq(vehicleCheckIns.vehicleId, vehicleId), eq(vehicleCheckIns.isActive, true)))
    .limit(1);
  return checkInInScope(scope, (ci?.shop as any) ?? null);
}

// Job-card-id actions: returns an error message if the card is outside the
// caller's shop OR warranty scope; null when allowed (or the card is missing —
// the caller's own not-found path handles that). No-op for unrestricted users.
async function jobCardScopeError(scope: UserScope, jobCardId: string): Promise<string | null> {
  const [jc] = await db
    .select({ checkInShop: vehicleCheckIns.shop, serviceType: jobCards.serviceType })
    .from(jobCards)
    .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
    .where(eq(jobCards.id, jobCardId))
    .limit(1);
  if (!jc) return null;
  if (!checkInInScope(scope, jc.checkInShop as any)) return 'Access denied: this job card belongs to another shop.';
  if (!warrantyInScope(scope, jc.serviceType)) return 'Access denied: this is not a warranty job card.';
  return null;
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
export async function getDashboard(request: FastifyRequest) {
  try {
    const q = request.query as any;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const { filter, sortOrder, dateFrom, dateTo } = q;
    const offset = (page - 1) * limit;

    // Shop scoping (on top of JOB_CARD:view). undefined for super-admin / ALL
    // (Service Advisors); narrows the list to a Major/Service controller's shop
    // via the vehicle's active check-in. Applied to the record list + total
    // below. (Stat-card counts are intentionally left global for now — see the
    // Step 5 note; they expose aggregate numbers, not records.)
    const scope = await resolveUserScope(request);

    const dateFromVal = dateFrom ? new Date(`${dateFrom}T00:00:00.000`) : undefined;
    const dateToVal = dateTo ? new Date(`${dateTo}T23:59:59.999`) : undefined;

    const allStatuses = SA_FILTER_STATUS_MAP.ALL;
    const filterStatuses = SA_FILTER_STATUS_MAP[filter] ?? allStatuses;

    // Date boundaries
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);
    yesterdayEnd.setMilliseconds(-1);

    // Stats — today
    const [inspectionDoneCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Inspection Done'),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [jobCardDraftCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Job Card (Draft)'),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [pendingApprovalCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, ['Job Card (Pending Cust. Approval)', 'Job Card (Partial Cust. Approval)', 'Job Card (Full Cust. Approval)']),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [inServiceCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'In Service'),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [totalActiveCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, allStatuses),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [readyForBillingCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Ready for Billing'),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    // Stats — yesterday
    const [inspectionDoneYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Inspection Done'),
          gte(vehicles.entryTime, yesterdayStart),
          lte(vehicles.entryTime, yesterdayEnd),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [jobCardDraftYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Job Card (Draft)'),
          gte(vehicles.entryTime, yesterdayStart),
          lte(vehicles.entryTime, yesterdayEnd),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [pendingApprovalYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, ['Job Card (Pending Cust. Approval)', 'Job Card (Partial Cust. Approval)', 'Job Card (Full Cust. Approval)']),
          gte(vehicles.entryTime, yesterdayStart),
          lte(vehicles.entryTime, yesterdayEnd),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [inServiceYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'In Service'),
          gte(vehicles.entryTime, yesterdayStart),
          lte(vehicles.entryTime, yesterdayEnd),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const [readyForBillingYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Ready for Billing'),
          gte(vehicles.entryTime, yesterdayStart),
          lte(vehicles.entryTime, yesterdayEnd),
          eq(vehicles.isActive, true),
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    const dateOrCondition = (dateFromVal || dateToVal)
      ? or(
          and(
            ...(dateFromVal ? [gte(vehicles.entryTime, dateFromVal)] : []),
            ...(dateToVal ? [lte(vehicles.entryTime, dateToVal)] : []),
          ),
          and(
            ...(dateFromVal ? [gte(vehicles.updatedAt, dateFromVal)] : []),
            ...(dateToVal ? [lte(vehicles.updatedAt, dateToVal)] : []),
          ),
        )
      : undefined;

    // Total for pagination
    const [{ total }] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, filterStatuses),
          eq(vehicles.isActive, true),
          dateOrCondition,
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      );

    // Active vehicles list
    const rows = await db
      .select({
        vehicleId: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        vehicleStatus: vehicles.status,
        entryTime: vehicles.entryTime,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerId: customers.id,
        frontImage:
          sql<string | null>`(SELECT image_path FROM vehicle_images WHERE vehicle_id = ${vehicles.id} AND image_category = 'Front View' LIMIT 1)`,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(
        and(
          inArray(vehicles.status, filterStatuses),
          eq(vehicles.isActive, true),
          dateOrCondition,
          shopVehicleFilter(scope),
          warrantyVehicleFilter(scope),
        ),
      )
      .orderBy(
        sortOrder === 'asc'
          ? sql`${vehicles.entryTime} ASC`
          : sql`${vehicles.entryTime} DESC`,
      )
      .limit(limit)
      .offset(offset);

    // Fetch service type from latest QC inspection for each vehicle
    const vehicleIds = rows.map((r: any) => r.vehicleId);
    let serviceTypeMap = new Map<string, string | null>();

    if (vehicleIds.length > 0) {
      const inspections = await db
        .select({
          vehicleId: vehicleCheckIns.vehicleId,
          serviceType: qcInspections.serviceType,
        })
        .from(qcInspections)
        .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
        .where(
          and(
            sql`${vehicleCheckIns.vehicleId} IN (${sql.join(
              vehicleIds.map((id: any) => sql`${id}`),
              sql`, `,
            )})`,
            eq(qcInspections.status, 'COMPLETED'),
          ),
        )
        .orderBy(desc(qcInspections.completedAt));

      for (const insp of inspections) {
        if (!serviceTypeMap.has(insp.vehicleId)) {
          serviceTypeMap.set(insp.vehicleId, insp.serviceType);
        }
      }
    }

    // Check which vehicles have job cards, and capture the Evolve RO number
    // (job card reference) for display (AI-4). Ordered oldest→newest so the
    // last write per vehicle keeps the most recent job card's reference.
    let jobCardMap = new Map<string, boolean>();
    let jobCardRefMap = new Map<string, string | null>();
    if (vehicleIds.length > 0) {
      const jcRows = await db
        .select({
          vehicleId: jobCards.vehicleId,
          evolveRoNumber: jobCards.evolveRoNumber,
        })
        .from(jobCards)
        .where(
          sql`${jobCards.vehicleId} IN (${sql.join(
            vehicleIds.map((id: any) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .orderBy(jobCards.createdAt);

      for (const jc of jcRows) {
        jobCardMap.set(jc.vehicleId, true);
        jobCardRefMap.set(jc.vehicleId, jc.evolveRoNumber ?? null);
      }
    }

    const now = new Date();
    const activeVehicles = await Promise.all(
      rows.map(async (row: any) => {
        const entry = new Date(row.entryTime!);
        const diffMs = now.getTime() - entry.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;

        return {
          vehicleId: row.vehicleId,
          registrationNumber: row.registrationNumber,
          brand: row.brand,
          model: row.model,
          customerName:
            `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim() || null,
          serviceType: serviceTypeMap.get(row.vehicleId) ?? null,
          waitingTime: h > 0 ? `${h}h ${m}m` : `${m} Mins`,
          status: row.vehicleStatus,
          hasJobCard: jobCardMap.has(row.vehicleId),
          jobCardReference: jobCardRefMap.get(row.vehicleId) ?? null,
          frontImage: await signUrl(row.frontImage),
        };
      }),
    );

    return success('Service advisor dashboard fetched successfully', {
      stats: {
        inspectionDone: inspectionDoneCount.total,
        inspectionDoneYesterday: inspectionDoneYesterdayCount.total,
        jobCardDraft: jobCardDraftCount.total,
        jobCardDraftYesterday: jobCardDraftYesterdayCount.total,
        pendingApproval: pendingApprovalCount.total,
        pendingApprovalYesterday: pendingApprovalYesterdayCount.total,
        totalActive: totalActiveCount.total,
        inService: inServiceCount.total,
        inServiceYesterday: inServiceYesterdayCount.total,
        readyForBilling: readyForBillingCount.total,
        readyForBillingYesterday: readyForBillingYesterdayCount.total,
      },
      activeVehicles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Vehicle Details ────────────────────────────────────────────────────────
export async function getVehicleDetails(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const scope = await resolveUserScope(request);
    if (!(await vehicleInShopScope(scope, vehicleId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    // Vehicle + customer info
    const [vehicle] = await db
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        modelVariant: vehicles.modelVariant,
        vin: vehicles.vin,
        status: vehicles.status,
        entryTime: vehicles.entryTime,
        customerId: vehicles.customerId,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerEmail: customers.primaryEmail,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Customer phone
    let customerPhone: string | null = null;
    if (vehicle.customerId) {
      const [contact] = await db
        .select({ contactNumber: customerContacts.contactNumber, countryCode: customerContacts.countryCode })
        .from(customerContacts)
        .where(eq(customerContacts.customerId, vehicle.customerId))
        .limit(1);
      if (contact) {
        customerPhone = `${contact.countryCode ?? ''} ${contact.contactNumber ?? ''}`.trim();
      }
    }

    // Service progress - determine which stages are complete
    const serviceProgress = {
      entry: { status: 'completed' as string },
      qc: { status: 'pending' as string },
      approval: { status: 'pending' as string },
      service: { status: 'pending' as string },
      billing: { status: 'pending' as string },
    };

    const statusOrder = [
      'Entry (Draft)',                        // 0
      'Vehicle IN',                           // 1
      'Inspection (Draft)',                   // 2
      'Inspection Done',                      // 3
      'Job Card (Draft)',                     // 4
      'Job Card (Pending Parts Approval)',    // 5
      'Job Card (Parts Approval Done)',       // 6
      'Job Card (Pending Cust. Approval)',    // 7
      'Job Card (Partial Cust. Approval)',    // 8
      'Job Card (Full Cust. Approval)',       // 9
      'In Service',                           // 10
      'Ready for Billing',                   // 11
      'Completed',                           // 12
    ];
    const currentIdx = statusOrder.indexOf(vehicle.status);

    if (currentIdx >= 3) serviceProgress.qc.status = 'completed';
    else if (currentIdx >= 2) serviceProgress.qc.status = 'in_progress';

    if (currentIdx >= 9) serviceProgress.approval.status = 'completed';
    else if (currentIdx >= 4) serviceProgress.approval.status = 'in_progress';

    if (currentIdx >= 11) serviceProgress.service.status = 'completed';
    else if (currentIdx >= 10) serviceProgress.service.status = 'in_progress';

    if (currentIdx >= 12) serviceProgress.billing.status = 'completed';
    else if (currentIdx === 11) serviceProgress.billing.status = 'in_progress';

    // Latest QC inspection
    const [latestInspection] = await db
      .select({
        id: qcInspections.id,
        overallStatus: qcInspections.overallStatus,
        completedAt: qcInspections.completedAt,
      })
      .from(qcInspections)
      .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
      .where(
        and(
          eq(vehicleCheckIns.vehicleId, vehicleId),
          eq(qcInspections.status, 'COMPLETED'),
        ),
      )
      .orderBy(desc(qcInspections.completedAt))
      .limit(1);

    // Latest job card
    const [latestJobCard] = await db
      .select({
        id: jobCards.id,
        status: jobCards.status,
        totalEstimate: jobCards.totalEstimate,
        createdAt: jobCards.createdAt,
      })
      .from(jobCards)
      .where(eq(jobCards.vehicleId, vehicleId))
      .orderBy(desc(jobCards.createdAt))
      .limit(1);

    // Vehicle image (prefer FRONT)
    const vehicleImageRows = await db
      .select({ imagePath: vehicleImages.imagePath, imageCategory: vehicleImages.imageCategory })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, vehicleId));
    const frontImage =
      vehicleImageRows.find((i) => (i.imageCategory ?? '').toUpperCase() === 'FRONT') ??
      vehicleImageRows[0];
    const vehicleImageUrl = frontImage?.imagePath ? await signUrl(frontImage.imagePath) : null;

    return success('Vehicle details fetched successfully', {
      vehicle: {
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        modelVariant: vehicle.modelVariant,
        vin: vehicle.vin,
        status: vehicle.status,
        imageUrl: vehicleImageUrl,
      },
      // The company this vehicle belongs to, resolved with the SAME chain the
      // RO push uses (resolveVehicleCompanyId). The Create Job Card screen
      // passes it to /franchise-service-depts so the Franchise / Service Dept
      // options are the ones valid for the company the RO will actually post
      // to. null when unknown → the screen falls back to the unfiltered list.
      companyId: await resolveVehicleCompanyId(vehicleId),
      customer: {
        // id is needed by the Create Job Card screen to fetch this customer's
        // Evolve AR accounts. Already selected in the query above — only the
        // projection omitted it.
        id: vehicle.customerId,
        name: `${vehicle.customerFirstName ?? ''} ${vehicle.customerLastName ?? ''}`.trim() || null,
        email: vehicle.customerEmail,
        phone: customerPhone,
      },
      serviceProgress,
      latestInspection: latestInspection ?? null,
      latestJobCard: latestJobCard ?? null,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── QC Report ──────────────────────────────────────────────────────────────
export async function getQcReport(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const scope = await resolveUserScope(request);
    if (!(await vehicleInShopScope(scope, vehicleId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    // Find the latest completed inspection for this vehicle
    const [inspection] = await db
      .select({
        id: qcInspections.id,
        status: qcInspections.status,
        overallStatus: qcInspections.overallStatus,
        brakePerformance: qcInspections.brakePerformance,
        brakeNoise: qcInspections.brakeNoise,
        brakeVibration: qcInspections.brakeVibration,
        finalRemarks: qcInspections.finalRemarks,
        completedAt: qcInspections.completedAt,
        vehicleCheckInId: qcInspections.vehicleCheckInId,
      })
      .from(qcInspections)
      .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
      .where(
        and(
          eq(vehicleCheckIns.vehicleId, vehicleId),
          eq(qcInspections.status, 'COMPLETED'),
        ),
      )
      .orderBy(desc(qcInspections.completedAt))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'No completed QC inspection found for this vehicle');
    }

    // Fetch confirmation components added by the QC inspector
    const components = await db
      .select({
        id: qcConfirmationComponents.id,
        majorComponent: qcConfirmationComponents.majorComponent,
        itemNumber: qcConfirmationComponents.itemNumber,
        comment: qcConfirmationComponents.comment,
        sortOrder: qcConfirmationComponents.sortOrder,
      })
      .from(qcConfirmationComponents)
      .where(eq(qcConfirmationComponents.inspectionId, inspection.id))
      .orderBy(qcConfirmationComponents.sortOrder);

    // Fetch workshop rework (one row per inspection)
    const [workshopRework] = await db
      .select({
        majorComponent: qcWorkshopRework.majorComponent,
        technician: qcWorkshopRework.technician,
        itemNumber: qcWorkshopRework.itemNumber,
        comments: qcWorkshopRework.comments,
      })
      .from(qcWorkshopRework)
      .where(eq(qcWorkshopRework.inspectionId, inspection.id))
      .limit(1);

    // Fetch customer complaints from the appointment linked to this check-in.
    // Prefer the direct link; fall back to most recent appointment for the
    // vehicle (same fallback used in QC inspection details).
    let [appointmentRow] = await db
      .select({
        bookingRef: appointments.bookingRef,
        serviceType: appointments.serviceType,
        complaints: appointments.complaints,
        appointmentDate: appointments.appointmentDate,
        appointmentTime: appointments.appointmentTime,
      })
      .from(appointments)
      .where(eq(appointments.checkInId, inspection.vehicleCheckInId))
      .limit(1);

    if (!appointmentRow) {
      [appointmentRow] = await db
        .select({
          bookingRef: appointments.bookingRef,
          serviceType: appointments.serviceType,
          complaints: appointments.complaints,
          appointmentDate: appointments.appointmentDate,
          appointmentTime: appointments.appointmentTime,
        })
        .from(appointments)
        .where(eq(appointments.vehicleId, vehicleId))
        .orderBy(desc(appointments.createdAt))
        .limit(1);
    }

    // Fetch all items
    const items = await db
      .select()
      .from(qcInspectionItems)
      .where(eq(qcInspectionItems.inspectionId, inspection.id))
      .orderBy(qcInspectionItems.sortOrder);

    // Group items by category. Categories are DYNAMIC since
    // 0060_qc_truck_checklist widened qc_inspection_items.category from the
    // qc_category enum to varchar (truck sheet uses Engine, Cooling System, …).
    // The three legacy keys are seeded so clients reading categories.EXTERIOR
    // get an array rather than undefined; other buckets are created on demand.
    const categories: Record<string, any[]> = {
      EXTERIOR: [],
      INTERIOR: [],
      BRAKE: [],
    };

    let passCount = 0;
    let failCount = 0;
    let warningCount = 0;
    const failedItems: any[] = [];

    for (const item of items) {
      const entry = {
        id: item.id,
        itemCode: item.itemCode,
        itemLabel: item.itemLabel,
        result: item.result,
        comment: item.comment,
      };
      if (!categories[item.category]) categories[item.category] = [];
      categories[item.category].push(entry);

      if (item.result === 'PASS') passCount++;
      else if (item.result === 'FAIL') {
        failCount++;
        failedItems.push(entry);
      } else if (item.result === 'NA') warningCount++;
    }

    return success('QC report fetched successfully', {
      inspectionId: inspection.id,
      overallStatus: inspection.overallStatus,
      completedAt: inspection.completedAt,
      brakeTestSummary: {
        performance: inspection.brakePerformance,
        noise: inspection.brakeNoise,
        vibration: inspection.brakeVibration,
      },
      finalRemarks: inspection.finalRemarks,
      categories,
      summary: {
        totalItems: items.length,
        passCount,
        failCount,
        warningCount,
      },
      failedItems,
      components,
      workshopRework: workshopRework ?? null,
      appointment: appointmentRow ?? null,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Vehicle History ────────────────────────────────────────────────────────
export async function getVehicleHistory(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const scope = await resolveUserScope(request);
    if (!(await vehicleInShopScope(scope, vehicleId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    // Verify vehicle exists
    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    const history = await db
      .select()
      .from(vehicleServiceHistory)
      .where(eq(vehicleServiceHistory.vehicleId, vehicleId))
      .orderBy(desc(vehicleServiceHistory.serviceDate));

    return success('Vehicle service history fetched successfully', { history });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Suggested Jobs ─────────────────────────────────────────────────────────
export async function getSuggestedJobs(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const scope = await resolveUserScope(request);
    if (!(await vehicleInShopScope(scope, vehicleId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    // Find the latest completed inspection
    const [inspection] = await db
      .select({ id: qcInspections.id })
      .from(qcInspections)
      .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
      .where(
        and(
          eq(vehicleCheckIns.vehicleId, vehicleId),
          eq(qcInspections.status, 'COMPLETED'),
        ),
      )
      .orderBy(desc(qcInspections.completedAt))
      .limit(1);

    if (!inspection) {
      return success('No completed inspection found', { suggestedJobs: [] });
    }

    // Get only failed items as suggestions (NA means no action needed)
    const failedItems = await db
      .select({
        itemCode: qcInspectionItems.itemCode,
        itemLabel: qcInspectionItems.itemLabel,
        category: qcInspectionItems.category,
        result: qcInspectionItems.result,
        comment: qcInspectionItems.comment,
      })
      .from(qcInspectionItems)
      .where(
        and(
          eq(qcInspectionItems.inspectionId, inspection.id),
          eq(qcInspectionItems.result, 'FAIL'),
        ),
      )
      .orderBy(qcInspectionItems.sortOrder);

    const suggestedJobs = failedItems.map((item: any) => ({
      itemCode: item.itemCode,
      itemLabel: item.itemLabel,
      category: item.category,
      result: item.result,
      comment: item.comment,
      suggestedDescription: `${item.itemLabel} - Repair/Replace`,
    }));

    return success('Suggested jobs fetched successfully', { suggestedJobs });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create Job Card ────────────────────────────────────────────────────────
// AI-3: a supplied Franchise/Service-Dept id must reference a real
// franchise_service_departments row, else the FK would surface as a 500. Shared
// by create + update. NULL/empty is allowed (RO keeps its '1'/'1' default).
async function franchiseServiceDeptExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: franchiseServiceDepartments.id })
    .from(franchiseServiceDepartments)
    .where(eq(franchiseServiceDepartments.id, id))
    .limit(1);
  return !!row;
}

// Create one 'pending' part request per parts item (non-LABOUR) on the job card.
// Shared by requestPartsConfirmation (first-time) and updateJobCard (regenerate
// after an estimate-affecting edit) so the parts-request creation lives in ONE
// place. Runs inside the caller's transaction. Returns the number created.
// Callers that rebuild items first rely on the FK cascade to have already
// removed the old requests; the defensive delete keeps it correct otherwise.
async function insertPendingPartRequests(tx: any, jobCardId: string, vehicleId: string): Promise<number> {
  await tx.delete(partRequests).where(eq(partRequests.jobCardId, jobCardId));
  const partsItems = await tx
    .select()
    .from(jobCardItems)
    .where(
      and(
        eq(jobCardItems.jobCardId, jobCardId),
        isNotNull(jobCardItems.partsRequired),
        sql`UPPER(${jobCardItems.partsRequired}) <> 'LABOUR'`,
      ),
    );
  for (const item of partsItems) {
    await tx.insert(partRequests).values({
      jobCardId,
      jobCardItemId: item.id,
      vehicleId,
      partName: item.partsRequired!,
      partNumber: `Qty: ${item.quantity}`,
      quantity: item.quantity,
      status: 'pending',
    });
  }
  return partsItems.length;
}

// One-line human summary for the edit-history audit row.
function buildEditSummary(estimateAffected: boolean, outcome: ReturnType<typeof resolveEditOutcome>, fromStatus: string): string {
  if (!estimateAffected) return 'Non-estimate-affecting edit (metadata only); parts confirmation and approval preserved.';
  const parts: string[] = ['Estimate-affecting edit'];
  if (outcome.regeneratePartRequests) parts.push('parts requests regenerated (reconfirmation required)');
  if (outcome.setReconfirmationFlag) parts.push('parts confirmation invalidated (status preserved)');
  if (outcome.invalidateApproval) parts.push('previous customer approval invalidated');
  if (outcome.statusChanged) parts.push(`lifecycle regressed ${fromStatus} → ${outcome.targetStatus}`);
  return parts.join('; ') + '.';
}

export async function createJobCard(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const body = request.body as any;
    const scope = await resolveUserScope(request);

    // Verify vehicle exists
    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Job Type is mandatory when Job Types are configured. Mirrors the UI rule
    // and is only enforced when the job_types lookup is populated, so an unseeded
    // deployment isn't hard-blocked from creating job cards.
    if (!String(body.jobType ?? '').trim()) {
      const [anyJobType] = await db
        .select({ id: jobTypes.id })
        .from(jobTypes)
        .where(eq(jobTypes.isActive, true))
        .limit(1);
      if (anyJobType) {
        return error(HttpStatus.BAD_REQUEST, 'Job type is required', 'jobType');
      }
    }

    // AI-3: reject a job card that references an unknown Franchise/Service-Dept id
    // with a clean 400 (see franchiseServiceDeptExists).
    if (body.franchiseServiceDeptId && !(await franchiseServiceDeptExists(body.franchiseServiceDeptId))) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid franchise/service department', 'franchiseServiceDeptId');
    }

    // Shop scope (IDOR guard) — a scoped user can only create a job card on a
    // vehicle whose active check-in is in their shop.
    const [scopeCheckIn] = await db
      .select({ shop: vehicleCheckIns.shop })
      .from(vehicleCheckIns)
      .where(and(eq(vehicleCheckIns.vehicleId, vehicleId), eq(vehicleCheckIns.isActive, true)))
      .limit(1);
    if (!checkInInScope(scope, (scopeCheckIn?.shop as any) ?? null)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    // Flatten jobs → items, tagging each with its parent job's serviceType/
    // serviceCategory, jobType, and its 1-based job index (jobGroup) for
    // multi-job RO sync.
    const flatItems = body.jobs.flatMap((job: any, jobIdx: number) =>
      job.items.map((item: any) => ({
        ...item,
        serviceType: job.serviceType ?? null,
        serviceCategory: job.serviceCategory ?? null,
        jobType: job.jobType ?? null,
        // Per-job AR account → ROJobHeader <ARAccountNo>. Flattened onto every
        // item of the job, exactly as jobType is, so both stay at job grain.
        arAccountNo: job.arAccountNo ?? null,
        // Per-item hours (labour lines) win over the job-group value.
        estimatedHours: item.estimatedHours ?? job.estimatedHours ?? null,
        jobGroup: jobIdx + 1,
      })),
    );

    const itemsWithTotals = flatItems.map((item: any, idx: number) => {
      // Manual Part Price Override: parts_cost = effective (manual ?? evolve).
      const price = resolveItemPrice({
        partsCost: item.partsCost,
        evolveUnitPrice: item.evolveUnitPrice,
        manualUnitPrice: item.manualUnitPrice,
      });
      item.partsCost = price.effectiveUnitPrice;
      item.evolveUnitPrice = price.evolveUnitPrice;
      item.manualUnitPrice = price.manualUnitPrice;
      item.isPriceOverridden = price.isPriceOverridden;
      const lineTotal = (item.partsCost * item.quantity) + item.labourCost;
      return { ...item, lineTotal, sortOrder: idx + 1 };
    });

    const subtotal = itemsWithTotals.reduce((sum: number, item: any) => sum + item.lineTotal, 0);
    const taxAmount = (subtotal * body.taxPercentage) / 100;
    const totalEstimate = subtotal + taxAmount;

    // Derive card-level summary from unique job values
    const cardServiceType = [...new Set(body.jobs.map((j: any) => j.serviceType).filter(Boolean))].join(', ') || null;
    const cardServiceCategory = [...new Set(body.jobs.map((j: any) => j.serviceCategory).filter(Boolean))].join(', ') || null;
    // Card-level Job Type is now per-job; keep job_cards.jobType as the first
    // job's type (single-block RO fallback + backward compatibility).
    const cardJobType = body.jobs.find((j: any) => j.jobType)?.jobType ?? body.jobType ?? null;

    // Warranty scope — a warranty-only clerk may only create/keep WARRANTY_SERVICE
    // job cards (no-op for everyone else).
    if (!warrantyInScope(scope, cardServiceType)) {
      return error(
        HttpStatus.FORBIDDEN,
        `Warranty clerks may only work on ${WARRANTY_SERVICE_CODE} job cards.`,
      );
    }

    // Find the active check-in for this vehicle to link the job card to the current visit
    const [activeCheckIn] = await db
      .select({ id: vehicleCheckIns.id })
      .from(vehicleCheckIns)
      .where(and(eq(vehicleCheckIns.vehicleId, vehicleId), eq(vehicleCheckIns.isActive, true)))
      .limit(1);

    // Resolve actor, guarding against tokens whose userId no longer exists
    const rawUserId = (request as any).user?.userId as string | undefined;
    let createdBy: string | null = null;
    if (rawUserId) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, rawUserId)).limit(1);
      createdBy = u?.id ?? null;
    }

    const result = await db.transaction(async (tx: any) => {
      const [jobCard] = await tx
        .insert(jobCards)
        .values({
          vehicleId,
          inspectionId: body.inspectionId ?? null,
          vehicleCheckInId: activeCheckIn?.id ?? null,
          status: 'DRAFT',
          serviceType: cardServiceType,
          serviceCategory: cardServiceCategory,
          // Evolve RO Job Type (AI-1). Per-job now; store the first job's type
          // here for the single-block RO fallback. NULL → 'INT' default at push.
          jobType: cardJobType,
          // Evolve RO Franchise / Service Dept (AI-3). Chosen labeled pair id;
          // NULL → preserves the existing '1' / '1' default at RO push.
          franchiseServiceDeptId: body.franchiseServiceDeptId ?? null,
          subtotal: subtotal.toFixed(2),
          taxLabel: body.taxLabel,
          taxPercentage: body.taxPercentage.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          totalEstimate: totalEstimate.toFixed(2),
          currencyCode: body.currencyCode,
          createdBy,
        })
        .returning();

      const itemValues = itemsWithTotals.map((item: any) => ({
        jobCardId: jobCard.id,
        jobDescription: item.jobDescription,
        partsRequired: item.partsRequired ?? null,
        serviceType: item.serviceType ?? null,
        serviceCategory: item.serviceCategory ?? null,
        jobGroup: item.jobGroup ?? 1,
        jobType: item.jobType ?? null,
        evolveArAccountNo: item.arAccountNo ?? null,
        estimatedHours: item.estimatedHours != null ? String(item.estimatedHours) : null,
        notes: item.notes ?? null,
        partsCost: item.partsCost.toFixed(2),
        evolveUnitPrice: item.evolveUnitPrice != null ? Number(item.evolveUnitPrice).toFixed(2) : null,
        manualUnitPrice: item.manualUnitPrice != null ? Number(item.manualUnitPrice).toFixed(2) : null,
        isPriceOverridden: !!item.isPriceOverridden,
        labourCost: item.labourCost.toFixed(2),
        quantity: item.quantity,
        lineTotal: item.lineTotal.toFixed(2),
        sortOrder: item.sortOrder,
        isWarrantyClaim: !!item.isWarrantyClaim,
        warrantyClaimNo: item.warrantyClaimNo ?? null,
        warrantyOem: item.warrantyOem ?? null,
      }));

      const items = await tx
        .insert(jobCardItems)
        .values(itemValues)
        .returning();

      // Update vehicle status to Job Card (Draft)
      await tx
        .update(vehicles)
        .set({ status: 'Job Card (Draft)', updatedAt: new Date() })
        .where(eq(vehicles.id, vehicleId));

      return { jobCard, items };
    });

    // DORMANT post-commit Evolve push (no-op unless EVOLVE_JOB_CARD_SYNC_ENABLED).
    void syncJobCardToEvolveRo(result.jobCard.id).catch(() => { /* logged inside */ });

    return created('Job card created successfully', result);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Job Card ───────────────────────────────────────────────────────────
export async function getJobCard(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const scope = await resolveUserScope(request);

    const [jobCard] = await db
      .select()
      .from(jobCards)
      .where(eq(jobCards.id, id))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Job card not found');
    }

    // Shop scope (IDOR guard) — derive the card's shop from its check-in.
    let jcShop: 'SERVICE' | 'MAJOR' | 'PDI' | null = null;
    if (jobCard.vehicleCheckInId) {
      const [ci] = await db
        .select({ shop: vehicleCheckIns.shop })
        .from(vehicleCheckIns)
        .where(eq(vehicleCheckIns.id, jobCard.vehicleCheckInId))
        .limit(1);
      jcShop = (ci?.shop as any) ?? null;
    }
    if (!checkInInScope(scope, jcShop)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this job card belongs to another shop.');
    }
    // Warranty scope (IDOR guard) — warranty clerks cannot open non-warranty cards.
    if (!warrantyInScope(scope, jobCard.serviceType)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this is not a warranty job card.');
    }

    const rawItems = await db
      .select()
      .from(jobCardItems)
      .where(eq(jobCardItems.jobCardId, id))
      .orderBy(jobCardItems.sortOrder);

    // Attach part request status to each item
    const partRequestRows = await db
      .select({
        jobCardItemId: partRequests.jobCardItemId,
        partStatus: partRequests.status,
        expectedTime: partRequests.expectedTime,
      })
      .from(partRequests)
      .where(eq(partRequests.jobCardId, id));

    const partStatusByItemId = new Map(
      partRequestRows.map((r: any) => [r.jobCardItemId, { partStatus: r.partStatus, expectedTime: r.expectedTime }]),
    );

    const items = rawItems.map((item: any) => {
      const partInfo = partStatusByItemId.get(item.id) as any;
      // Labour line: catalogue part_code = 'LABOUR'. Shown in costing but
      // excluded from technician assignment / parts confirmation.
      const isLabourOnly = String(item.partsRequired ?? '').trim().toUpperCase() === 'LABOUR';
      // Effective unit price == parts_cost (manual ?? evolve). evolveUnitPrice /
      // manualUnitPrice / isPriceOverridden come through from `...item`.
      return {
        ...item,
        partStatus: partInfo?.partStatus ?? null,
        partExpectedTime: partInfo?.expectedTime ?? null,
        isLabourOnly,
        effectiveUnitPrice: item.partsCost != null ? Number(item.partsCost) : null,
      };
    });

    // Vehicle + customer info
    const [vehicle] = await db
      .select({
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(eq(vehicles.id, jobCard.vehicleId))
      .limit(1);

    const vehicleImageRows = await db
      .select({ imagePath: vehicleImages.imagePath, imageCategory: vehicleImages.imageCategory })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, jobCard.vehicleId));
    const frontImage =
      vehicleImageRows.find((i) => (i.imageCategory ?? '').toUpperCase() === 'FRONT') ??
      vehicleImageRows[0];
    const vehicleImageUrl = frontImage?.imagePath ? await signUrl(frontImage.imagePath) : null;

    return success('Job card fetched successfully', {
      jobCard,
      items,
      vehicle: vehicle
        ? {
            registrationNumber: vehicle.registrationNumber,
            brand: vehicle.brand,
            model: vehicle.model,
            customerName:
              `${vehicle.customerFirstName ?? ''} ${vehicle.customerLastName ?? ''}`.trim() || null,
            imageUrl: vehicleImageUrl,
          }
        : null,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Job Cards for Vehicle ──────────────────────────────────────────────
export async function getVehicleJobCards(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const scope = await resolveUserScope(request);

    // Scope to the current (active) visit's job cards only — prior visits'
    // job cards are intentionally hidden here. The customer-approval flow no
    // longer closes the check-in prematurely (see customer-approval/service.ts),
    // so APPROVED → IN_PROGRESS work stays attached to its active visit.
    const [activeCheckIn] = await db
      .select({ id: vehicleCheckIns.id, shop: vehicleCheckIns.shop })
      .from(vehicleCheckIns)
      .where(and(eq(vehicleCheckIns.vehicleId, vehicleId), eq(vehicleCheckIns.isActive, true)))
      .limit(1);

    // Shop scope (IDOR guard) — block a scoped controller from another shop's vehicle.
    if (!checkInInScope(scope, (activeCheckIn?.shop as any) ?? null)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const cards = await db
      .select({
        id: jobCards.id,
        vehicleId: jobCards.vehicleId,
        inspectionId: jobCards.inspectionId,
        status: jobCards.status,
        subtotal: jobCards.subtotal,
        taxLabel: jobCards.taxLabel,
        taxPercentage: jobCards.taxPercentage,
        taxAmount: jobCards.taxAmount,
        totalEstimate: jobCards.totalEstimate,
        currencyCode: jobCards.currencyCode,
        sharedAt: jobCards.sharedAt,
        approvedAt: jobCards.approvedAt,
        modificationNote: jobCards.modificationNote,
        createdAt: jobCards.createdAt,
        updatedAt: jobCards.updatedAt,
        // Service type from linked QC inspection
        serviceType: sql<string | null>`(
          SELECT qi.service_type FROM qc_inspections qi
          WHERE qi.id = ${jobCards.inspectionId}
          LIMIT 1
        )`,
        // First job description from items
        description: sql<string | null>`(
          SELECT jci.job_description FROM job_card_items jci
          WHERE jci.job_card_id = ${jobCards.id}
          ORDER BY jci.sort_order ASC
          LIMIT 1
        )`,
      })
      .from(jobCards)
      .where(
        and(
          eq(jobCards.vehicleId, vehicleId),
          activeCheckIn ? eq(jobCards.vehicleCheckInId, activeCheckIn.id) : sql`false`,
          // Warranty-only clerks see only WARRANTY_SERVICE cards (no-op otherwise).
          warrantyFilter(scope),
        ),
      )
      .orderBy(desc(jobCards.createdAt));

    return success('Job cards fetched successfully', { jobCards: cards });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Job Card ────────────────────────────────────────────────────────
export async function updateJobCard(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;
    const actorId = await resolveActorId(request);
    const scope = await resolveUserScope(request);

    const [jobCard] = await db
      .select({
        id: jobCards.id,
        status: jobCards.status,
        vehicleId: jobCards.vehicleId,
        checkInShop: vehicleCheckIns.shop,
        serviceType: jobCards.serviceType,
        taxPercentage: jobCards.taxPercentage,
        totalEstimate: jobCards.totalEstimate,
      })
      .from(jobCards)
      .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
      .where(eq(jobCards.id, id))
      .limit(1);

    if (jobCard && !checkInInScope(scope, jobCard.checkInShop as any)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this job card belongs to another shop.');
    }
    if (jobCard && !warrantyInScope(scope, jobCard.serviceType)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this is not a warranty job card.');
    }

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Job card not found');
    }

    // Editing is allowed through the estimate/approval phase, but LOCKED once
    // work has started or the card is terminal (rebuilding items would destroy
    // technician assignments/time-logs/completion). Single source of truth = status.
    if (isEditLocked(jobCard.status)) {
      return error(
        HttpStatus.BAD_REQUEST,
        `Job card can no longer be edited once work has started. Current status: ${jobCard.status}`,
      );
    }

    // AI-3: same referential guard on update (null/omitted preserve/clear as before).
    if (body.franchiseServiceDeptId && !(await franchiseServiceDeptExists(body.franchiseServiceDeptId))) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid franchise/service department', 'franchiseServiceDeptId');
    }

    // Flatten jobs → items, tagging each with its parent job's serviceType/
    // serviceCategory, jobType, and its 1-based job index (jobGroup) for
    // multi-job RO sync.
    const flatItems = body.jobs.flatMap((job: any, jobIdx: number) =>
      job.items.map((item: any) => ({
        ...item,
        serviceType: job.serviceType ?? null,
        serviceCategory: job.serviceCategory ?? null,
        jobType: job.jobType ?? null,
        // Per-job AR account → ROJobHeader <ARAccountNo>. Flattened onto every
        // item of the job, exactly as jobType is, so both stay at job grain.
        arAccountNo: job.arAccountNo ?? null,
        // Per-item hours (labour lines) win over the job-group value.
        estimatedHours: item.estimatedHours ?? job.estimatedHours ?? null,
        jobGroup: jobIdx + 1,
      })),
    );

    const itemsWithTotals = flatItems.map((item: any, idx: number) => {
      // Manual Part Price Override: parts_cost = effective (manual ?? evolve).
      const price = resolveItemPrice({
        partsCost: item.partsCost,
        evolveUnitPrice: item.evolveUnitPrice,
        manualUnitPrice: item.manualUnitPrice,
      });
      item.partsCost = price.effectiveUnitPrice;
      item.evolveUnitPrice = price.evolveUnitPrice;
      item.manualUnitPrice = price.manualUnitPrice;
      item.isPriceOverridden = price.isPriceOverridden;
      const lineTotal = (item.partsCost * item.quantity) + item.labourCost;
      return { ...item, lineTotal, sortOrder: idx + 1 };
    });

    const subtotal = itemsWithTotals.reduce((sum: number, item: any) => sum + item.lineTotal, 0);
    const taxAmount = (subtotal * body.taxPercentage) / 100;
    const totalEstimate = subtotal + taxAmount;

    // Derive card-level summary from unique job values
    const cardServiceType = [...new Set(body.jobs.map((j: any) => j.serviceType).filter(Boolean))].join(', ') || null;
    const cardServiceCategory = [...new Set(body.jobs.map((j: any) => j.serviceCategory).filter(Boolean))].join(', ') || null;
    // Card-level Job Type is now per-job; keep job_cards.jobType as the first
    // job's type (single-block RO fallback + backward compatibility).
    const cardJobType = body.jobs.find((j: any) => j.jobType)?.jobType ?? body.jobType ?? null;

    // Warranty scope — a warranty-only clerk may only create/keep WARRANTY_SERVICE
    // job cards (no-op for everyone else).
    if (!warrantyInScope(scope, cardServiceType)) {
      return error(
        HttpStatus.FORBIDDEN,
        `Warranty clerks may only work on ${WARRANTY_SERVICE_CODE} job cards.`,
      );
    }

    // ── Estimate-impact detection + lifecycle outcome (pure logic in ./jobCardEdit) ──
    const existingItems = await db
      .select({
        jobDescription: jobCardItems.jobDescription,
        partsRequired: jobCardItems.partsRequired,
        partsCost: jobCardItems.partsCost,
        manualUnitPrice: jobCardItems.manualUnitPrice,
        labourCost: jobCardItems.labourCost,
        quantity: jobCardItems.quantity,
      })
      .from(jobCardItems)
      .where(eq(jobCardItems.jobCardId, id));

    const estimateAffected = isEstimateAffecting(
      existingItems,
      itemsWithTotals,
      jobCard.taxPercentage as any,
      body.taxPercentage,
    );
    const hasParts = itemsHaveParts(itemsWithTotals);
    const outcome = resolveEditOutcome(jobCard.status, estimateAffected, hasParts);

    // Manual Part Price Override audit — detect parts whose manual price was set,
    // changed, or cleared vs the previous save; recorded in the edit-history row.
    const oldByCode = new Map<string, { manual: number | null; effective: number }>();
    for (const oi of existingItems as any[]) {
      const code = String(oi.partsRequired ?? '').trim();
      if (code) oldByCode.set(code, {
        manual: oi.manualUnitPrice != null ? Number(oi.manualUnitPrice) : null,
        effective: Number(oi.partsCost) || 0,
      });
    }
    const overrideLines: string[] = [];
    for (const it of itemsWithTotals as any[]) {
      const code = String(it.partsRequired ?? '').trim();
      if (!code) continue;
      const old = oldByCode.get(code);
      if ((it.manualUnitPrice ?? null) !== (old?.manual ?? null)) {
        const prev = old ? old.effective : Number(it.evolveUnitPrice) || 0;
        overrideLines.push(`${code}: ${prev.toFixed(2)} → ${Number(it.partsCost).toFixed(2)}`);
      }
    }
    const priceOverrideSummary = overrideLines.length
      ? `Manual Part Price Override — ${overrideLines.join('; ')}`
      : null;

    const result = await db.transaction(async (tx: any) => {
      const setFields: any = {
        serviceType: cardServiceType,
        serviceCategory: cardServiceCategory,
        // Job Type is per-job now; keep the card-level column as the first job's
        // type (single-block RO fallback). Per-item jobType is written with the
        // rebuilt items below (estimate-affecting) or refreshed by jobGroup.
        jobType: cardJobType,
        // AI-3: only written when the FE sends the field (undefined preserves).
        ...(body.franchiseServiceDeptId !== undefined ? { franchiseServiceDeptId: body.franchiseServiceDeptId } : {}),
        taxLabel: body.taxLabel,
        currencyCode: body.currencyCode,
        updatedAt: new Date(),
        updatedBy: actorId,
      };

      let items: any;
      let updatedCard: any;

      if (estimateAffected) {
        // Rebuild items — cascade-deletes their old part_requests — and recompute totals.
        await tx.delete(jobCardItems).where(eq(jobCardItems.jobCardId, id));
        Object.assign(setFields, {
          subtotal: subtotal.toFixed(2),
          taxPercentage: body.taxPercentage.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          totalEstimate: totalEstimate.toFixed(2),
          // Lifecycle: preserve status unless a controlled regression is required.
          ...(outcome.statusChanged ? { status: outcome.targetStatus } : {}),
          // Parts reconfirmation flag (PARTS_CONFIRMED preserved case).
          partsReconfirmationRequired: outcome.setReconfirmationFlag,
          // Invalidate the prior customer approval when regressing post-share.
          ...(outcome.invalidateApproval
            ? { sharedAt: null, approvalToken: null, approvedAt: null, acceptedBy: null, acceptanceChannel: null, modificationNote: null }
            : {}),
        });

        const [updated] = await tx.update(jobCards).set(setFields).where(eq(jobCards.id, id)).returning();

        const itemValues = itemsWithTotals.map((item: any) => ({
          jobCardId: id,
          jobDescription: item.jobDescription,
          partsRequired: item.partsRequired ?? null,
          serviceType: item.serviceType ?? null,
          serviceCategory: item.serviceCategory ?? null,
          jobGroup: item.jobGroup ?? 1,
          jobType: item.jobType ?? null,
          evolveArAccountNo: item.arAccountNo ?? null,
          estimatedHours: item.estimatedHours != null ? String(item.estimatedHours) : null,
          partsCost: item.partsCost.toFixed(2),
          labourCost: item.labourCost.toFixed(2),
          quantity: item.quantity,
          lineTotal: item.lineTotal.toFixed(2),
          sortOrder: item.sortOrder,
          isWarrantyClaim: !!item.isWarrantyClaim,
          warrantyClaimNo: item.warrantyClaimNo ?? null,
          warrantyOem: item.warrantyOem ?? null,
        }));
        items = await tx.insert(jobCardItems).values(itemValues).returning();

        // Auto-regenerate parts requests (reuses the shared helper) so Parts
        // Reconfirmation runs through the existing PM workflow.
        if (outcome.regeneratePartRequests) {
          await insertPendingPartRequests(tx, id, jobCard.vehicleId as string);
        }

        // Paired vehicle status on a controlled regression.
        if (outcome.statusChanged && outcome.vehicleStatus) {
          await tx
            .update(vehicles)
            .set({ status: outcome.vehicleStatus, updatedAt: new Date(), updatedBy: actorId })
            .where(eq(vehicles.id, jobCard.vehicleId as string));
        }

        updatedCard = updated;
      } else {
        // Metadata-only edit: do NOT touch items, status, parts, or approval.
        const [updated] = await tx.update(jobCards).set(setFields).where(eq(jobCards.id, id)).returning();
        // Per-job Job Type may change without affecting the estimate. Items are
        // not rebuilt here, so refresh each job group's jobType in place (mapped
        // by jobGroup → body.jobs order) so the change still reaches the RO.
        for (let gi = 0; gi < body.jobs.length; gi++) {
          await tx
            .update(jobCardItems)
            .set({
              jobType: body.jobs[gi].jobType ?? null,
              estimatedHours: body.jobs[gi].estimatedHours != null ? String(body.jobs[gi].estimatedHours) : null,
              updatedAt: new Date(),
            })
            .where(and(eq(jobCardItems.jobCardId, id), eq(jobCardItems.jobGroup, gi + 1)));
        }
        items = await tx.select().from(jobCardItems).where(eq(jobCardItems.jobCardId, id));
        updatedCard = updated;
      }

      // Append-only audit (who / what / why) — same transaction so it never drifts.
      await tx.insert(jobCardEditHistory).values({
        jobCardId: id,
        editedBy: actorId,
        estimateAffected,
        reconfirmationTriggered: outcome.regeneratePartRequests || outcome.setReconfirmationFlag,
        approvalInvalidated: outcome.invalidateApproval,
        fromStatus: jobCard.status,
        toStatus: outcome.statusChanged ? outcome.targetStatus : jobCard.status,
        prevTotal: (jobCard.totalEstimate as any) ?? null,
        newTotal: estimateAffected ? totalEstimate.toFixed(2) : ((jobCard.totalEstimate as any) ?? null),
        summary: [buildEditSummary(estimateAffected, outcome, jobCard.status), priceOverrideSummary]
          .filter(Boolean)
          .join(' | '),
      });

      return { jobCard: updatedCard, items };
    });

    void syncJobCardUpdateToEvolve(id).catch(() => { /* logged inside */ });

    // Notify the Parts team when reconfirmation is actually required (parts exist).
    if (outcome.regeneratePartRequests) {
      const ref = (result.jobCard as any)?.evolveRoNumber || id.slice(0, 8);
      void notifyRoleInApp('parts-manager', {
        level: 'INFO',
        title: 'Parts Reconfirmation Required',
        body: `Job Card ${ref} was modified and requires Parts Reconfirmation.`,
        refType: 'job_card',
        refId: id,
      }).catch(() => { /* logged inside */ });
    }

    return success('Job card updated successfully', result);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Request Parts Confirmation from Parts Manager ───────────────────────────
export async function requestPartsConfirmation(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const userId = await resolveActorId(request);
    const scope = await resolveUserScope(request);
    const scopeErr = await jobCardScopeError(scope, id);
    if (scopeErr) return error(HttpStatus.FORBIDDEN, scopeErr);

    const [jobCard] = await db
      .select({ id: jobCards.id, status: jobCards.status, vehicleId: jobCards.vehicleId })
      .from(jobCards)
      .where(eq(jobCards.id, id))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Job card not found');
    }

    if (jobCard.status !== 'DRAFT') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Parts confirmation can only be requested for DRAFT job cards. Current status: ${jobCard.status}`,
      );
    }

    // Get job card items that have partsRequired — excluding labour lines
    // (catalogue part_code = 'LABOUR'), which are costing charges, not parts.
    const partsItems = await db
      .select()
      .from(jobCardItems)
      .where(
        and(
          eq(jobCardItems.jobCardId, id),
          isNotNull(jobCardItems.partsRequired),
          sql`UPPER(${jobCardItems.partsRequired}) <> 'LABOUR'`,
        ),
      );

    if (partsItems.length === 0) {
      return error(
        HttpStatus.BAD_REQUEST,
        'No items with parts required found. Add parts to job card items before requesting confirmation.',
      );
    }

    const now = new Date();

    await db.transaction(async (tx: any) => {
      // Create a 'pending' part request per parts item (shared helper — single
      // source of the part-request creation logic).
      await insertPendingPartRequests(tx, id, jobCard.vehicleId);

      // Transition job card to PENDING_PARTS
      await tx
        .update(jobCards)
        .set({ status: 'PENDING_PARTS' as any, updatedAt: now, updatedBy: userId })
        .where(eq(jobCards.id, id));

      // Transition vehicle status
      await tx
        .update(vehicles)
        .set({ status: 'Job Card (Pending Parts Approval)', updatedAt: now, updatedBy: userId })
        .where(eq(vehicles.id, jobCard.vehicleId));
    });

    return success('Parts confirmation request sent to Parts Manager', {
      jobCardId: id,
      status: 'PENDING_PARTS',
      partsRequestsCreated: partsItems.length,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Share Estimate with Customer ───────────────────────────────────────────
export async function shareEstimate(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const scope = await resolveUserScope(request);
    const scopeErr = await jobCardScopeError(scope, id);
    if (scopeErr) return error(HttpStatus.FORBIDDEN, scopeErr);

    const [jobCard] = await db
      .select({
        id: jobCards.id,
        status: jobCards.status,
        vehicleId: jobCards.vehicleId,
        subtotal: jobCards.subtotal,
        taxLabel: jobCards.taxLabel,
        taxPercentage: jobCards.taxPercentage,
        taxAmount: jobCards.taxAmount,
        totalEstimate: jobCards.totalEstimate,
        currencyCode: jobCards.currencyCode,
        partsReconfirmationRequired: jobCards.partsReconfirmationRequired,
      })
      .from(jobCards)
      .where(eq(jobCards.id, id))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Job card not found');
    }

    const currencyCode = jobCard.currencyCode || 'ZAR';

    // A prior estimate-affecting edit invalidated the parts confirmation while
    // preserving status — block sharing until parts are re-confirmed.
    if (jobCard.partsReconfirmationRequired) {
      return error(
        HttpStatus.BAD_REQUEST,
        'Parts Confirmation is required because this Job Card was modified. Please complete Parts Confirmation before sharing the estimate.',
      );
    }

    if (jobCard.status === 'PENDING_PARTS') {
      return error(
        HttpStatus.BAD_REQUEST,
        'Parts confirmation is pending. Wait for Parts Manager to confirm parts before sharing.',
      );
    }

    if (jobCard.status === 'DRAFT') {
      // Check if any items require parts confirmation
      const itemsWithParts = await db
        .select({ id: jobCardItems.id })
        .from(jobCardItems)
        .where(
          and(
            eq(jobCardItems.jobCardId, id),
            isNotNull(jobCardItems.partsRequired),
            sql`UPPER(${jobCardItems.partsRequired}) <> 'LABOUR'`,
          ),
        )
        .limit(1);

      if (itemsWithParts.length > 0) {
        return error(
          HttpStatus.BAD_REQUEST,
          'This job card has items requiring parts confirmation. Please request Parts Confirmation before sharing with the customer.',
        );
      }
    }

    // DRAFT = first share. PARTS_CONFIRMED = SA shares after PM confirms parts.
    // MODIFICATION_REQUESTED = a tech-raised part was priced by PM mid-repair;
    // SA reviews the new line item and re-shares for customer re-approval.
    if (
      jobCard.status !== 'DRAFT' &&
      jobCard.status !== 'PARTS_CONFIRMED' &&
      jobCard.status !== 'MODIFICATION_REQUESTED'
    ) {
      return error(
        HttpStatus.BAD_REQUEST,
        `Job card cannot be shared. Current status: ${jobCard.status}`,
      );
    }

    // Generate approval token
    const approvalToken = generateApprovalToken();
    const origin = request.headers.origin || request.headers.referer?.replace(/\/$/, '') || undefined;
    const approvalUrl = buildApprovalUrl(approvalToken, origin);

    const now = new Date();
    const userId = await resolveActorId(request);

    await db.transaction(async (tx: any) => {
      await tx
        .update(jobCards)
        .set({ status: 'SHARED', sharedAt: now, approvalToken, updatedAt: now, updatedBy: userId })
        .where(eq(jobCards.id, id));

      // Update vehicle status to Job Card (Pending Cust. Approval)
      await tx
        .update(vehicles)
        .set({ status: 'Job Card (Pending Cust. Approval)', updatedAt: now, updatedBy: userId })
        .where(eq(vehicles.id, jobCard.vehicleId));
    });

    // Notification block — racing against a 6s deadline so the API always
    // responds quickly. If WhatsApp / email haven't finished by then, we
    // return with notificationPending: true and they continue in the
    // background (logs only). Combined with SMTP timeouts in email.service,
    // this caps the worst-case response time at the deadline.
    const NOTIFY_DEADLINE_MS = 6_000;

    const notifyTask: Promise<{
      whatsappSent: boolean;
      emailSent: boolean;
      emailFailReason: string;
    }> = (async () => {
      let whatsappSent    = false;
      let emailSent       = false;
      let emailFailReason = '';

      try {
        const [vehicle] = await db
          .select({
            customerId: vehicles.customerId,
            brand: vehicles.brand,
            model: vehicles.model,
            registrationNumber: vehicles.registrationNumber,
          })
          .from(vehicles)
          .where(eq(vehicles.id, jobCard.vehicleId))
          .limit(1);

        if (vehicle?.customerId) {
          const [customer] = await db
            .select({
              firstName: customers.firstName,
              lastName: customers.lastName,
              companyName: customers.companyName,
              primaryEmail: customers.primaryEmail,
            })
            .from(customers)
            .where(eq(customers.id, vehicle.customerId))
            .limit(1);

          const [contact] = await db
            .select({
              countryCode: customerContacts.countryCode,
              contactNumber: customerContacts.contactNumber,
            })
            .from(customerContacts)
            .where(eq(customerContacts.customerId, vehicle.customerId))
            .limit(1);

          const customerName = customer?.companyName
            || [customer?.firstName, customer?.lastName].filter(Boolean).join(' ')
            || 'Customer';

          const vehicleInfo = `${vehicle.brand} ${vehicle.model} (${vehicle.registrationNumber || ''})`;

          const items = await db
            .select({
              jobDescription: jobCardItems.jobDescription,
              partsCost: jobCardItems.partsCost,
              labourCost: jobCardItems.labourCost,
              lineTotal: jobCardItems.lineTotal,
            })
            .from(jobCardItems)
            .where(eq(jobCardItems.jobCardId, id));

          const sends: Promise<unknown>[] = [];

          if (contact?.contactNumber) {
            sends.push(
              sendWhatsAppEstimate({
                customerName,
                customerPhone: contact.contactNumber,
                countryCode: contact.countryCode || '+27',
                vehicleInfo,
                totalEstimate: `₹${Number(jobCard.totalEstimate).toLocaleString('en-IN')}`,
                approvalUrl,
              }).then((r) => { whatsappSent = r.success; }),
            );
          }

          if (customer?.primaryEmail) {
            sends.push(
              sendEstimateEmail({
                customerName,
                customerEmail: customer.primaryEmail,
                vehicleInfo,
                items: items.map((it: any) => ({
                  jobDescription: it.jobDescription,
                  partsCost: Number(it.partsCost ?? 0),
                  labourCost: Number(it.labourCost ?? 0),
                  lineTotal: Number(it.lineTotal ?? 0),
                })),
                subtotal: Number(jobCard.subtotal ?? 0),
                taxLabel: jobCard.taxLabel ?? 'GST',
                taxPercentage: Number(jobCard.taxPercentage ?? 18),
                taxAmount: Number(jobCard.taxAmount ?? 0),
                totalEstimate: Number(jobCard.totalEstimate ?? 0),
                approvalUrl,
                currencyCode,
              }).then((r) => {
                emailSent = r.success;
                if (!r.success) emailFailReason = r.error ?? 'Unknown error';
              }),
            );
          } else {
            emailFailReason = 'No email address on customer record';
            console.warn(`[Email] Customer has no primaryEmail — skipping email for job card ${id}`);
          }

          // WhatsApp + email run in parallel.
          await Promise.all(sends);
        }
      } catch (err) {
        console.error('[Notify] Failed to send notifications:', err);
      }

      return { whatsappSent, emailSent, emailFailReason };
    })();

    // Make sure rejections from background work don't crash the process.
    notifyTask.catch((err) => console.error('[Notify] background error:', err));

    const TIMEOUT_SENTINEL = Symbol('notify-timeout');
    const result = await Promise.race([
      notifyTask,
      new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
        setTimeout(() => resolve(TIMEOUT_SENTINEL), NOTIFY_DEADLINE_MS),
      ),
    ]);

    const notificationPending = result === TIMEOUT_SENTINEL;
    const finalResult =
      notificationPending
        ? { whatsappSent: false, emailSent: false, emailFailReason: 'Sending in background' }
        : result;

    void syncJobCardUpdateToEvolve(id).catch(() => { /* logged inside */ });

    return success('Estimate shared with customer successfully', {
      jobCardId: id,
      status: 'SHARED',
      sharedAt: now.toISOString(),
      vehicleStatus: 'Job Card (Pending Cust. Approval)',
      whatsappSent: finalResult.whatsappSent,
      emailSent: finalResult.emailSent,
      emailFailReason: finalResult.emailSent ? undefined : finalResult.emailFailReason,
      notificationPending,
      approvalUrl,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Approve Job Card ───────────────────────────────────────────────────────
export async function approveJobCard(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const actorId = await resolveActorId(request);
    const scope = await resolveUserScope(request);

    const [jobCard] = await db
      .select({
        id: jobCards.id,
        status: jobCards.status,
        vehicleId: jobCards.vehicleId,
        serviceType: jobCards.serviceType,
        checkInShop: vehicleCheckIns.shop,
      })
      .from(jobCards)
      .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
      .where(eq(jobCards.id, id))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Job card not found');
    }

    // Scope (IDOR guards) — a scoped controller/clerk can only accept job cards
    // within their shop / warranty type. This is the authenticated in-app
    // acceptance path (a warranty clerk "acts as customer" for warranty jobs);
    // the public customer-link path lives in customer-approval.
    if (!checkInInScope(scope, jobCard.checkInShop as any)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this job card belongs to another shop.');
    }
    if (!warrantyInScope(scope, jobCard.serviceType)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this is not a warranty job card.');
    }

    if (jobCard.status !== 'SHARED') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Only SHARED job cards can be approved. Current status: ${jobCard.status}`,
      );
    }

    const now = new Date();

    await db.transaction(async (tx: any) => {
      await tx
        .update(jobCards)
        .set({
          status: 'APPROVED',
          approvedAt: now,
          // Provenance: staff accepted in-app on the customer's behalf.
          acceptedBy: actorId ?? null,
          acceptanceChannel: 'STAFF',
          updatedAt: now,
        })
        .where(eq(jobCards.id, id));

      // Update vehicle status to Job Card (Full Cust. Approval)
      await tx
        .update(vehicles)
        .set({ status: 'Job Card (Full Cust. Approval)', updatedAt: now })
        .where(eq(vehicles.id, jobCard.vehicleId));
    });

    void syncJobCardUpdateToEvolve(id).catch(() => { /* logged inside */ });

    return success('Job card approved successfully', {
      jobCardId: id,
      status: 'APPROVED',
      approvedAt: now.toISOString(),
      vehicleStatus: 'Job Card (Full Cust. Approval)',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Assign Technicians (per-item) ─────────────────────────────────────────
// Accepts a per-item assignment array. Each entry sets that item's technician,
// estimated hours, and priority. As soon as ANY item has a technician, the
// job card flips to IN_PROGRESS and the vehicle moves to 'In Service' — items
// without an assignment can be filled in later by re-opening the modal.
//
// Body shape:
//   { assignments: [
//       { itemId, technicianId, estimatedHours, priority }, ...
//   ] }
export async function assignTechnician(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const { assignments, bulk } = request.body as {
      assignments: Array<{
        itemId: string;
        technicianId: string;
        estimatedHours: number;
        // Evolve labour hours (decimal). Optional from older clients; when absent
        // they default to estimatedHours (worked) and worked (sold) below.
        hoursWorked?: number;
        hoursSold?: number;
        priority: 'LOW' | 'MEDIUM' | 'HIGH';
      }>;
      // Bulk Technician Allocation ("Assign All") — optional; drives an audit row.
      bulk?: boolean;
    };

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return error(HttpStatus.BAD_REQUEST, 'No assignments provided');
    }

    // Validate labour hours where supplied: non-negative decimals only.
    for (const a of assignments) {
      for (const [field, val] of [['hoursWorked', a.hoursWorked], ['hoursSold', a.hoursSold]] as const) {
        if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val) || val < 0)) {
          return error(HttpStatus.BAD_REQUEST, `Invalid ${field}: must be a non-negative number`);
        }
      }
    }

    const scope = await resolveUserScope(request);
    const [jobCard] = await db
      .select({ id: jobCards.id, status: jobCards.status, vehicleId: jobCards.vehicleId, checkInShop: vehicleCheckIns.shop })
      .from(jobCards)
      .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
      .where(eq(jobCards.id, id))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Job card not found');
    }
    // Shop scope (IDOR guard) — foreman can only assign techs on jobs in their shop.
    if (!checkInInScope(scope, jobCard.checkInShop as any)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this job card belongs to another shop.');
    }

    // Allow assignment when card is either APPROVED (first assignment) or
    // already IN_PROGRESS (filling in remaining items).
    if (jobCard.status !== 'APPROVED' && jobCard.status !== 'IN_PROGRESS') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Assignment requires APPROVED or IN_PROGRESS status. Current: ${jobCard.status}`,
      );
    }

    // Validate items belong to this job card.
    const itemIds = assignments.map((a) => a.itemId);
    const existingItems = await db
      .select({ id: jobCardItems.id, partsRequired: jobCardItems.partsRequired, partsCost: jobCardItems.partsCost })
      .from(jobCardItems)
      .where(and(eq(jobCardItems.jobCardId, id), inArray(jobCardItems.id, itemIds)));
    if (existingItems.length !== itemIds.length) {
      return error(HttpStatus.BAD_REQUEST, 'One or more items do not belong to this job card');
    }

    // Reject labour lines (catalogue part_code = 'LABOUR'). Labour is a costing
    // charge and must never be assigned to a technician — even if a manipulated
    // request slips one through the UI filter.
    const hasLabour = existingItems.some(
      (it) => (it.partsRequired ?? '').trim().toUpperCase() === 'LABOUR',
    );
    if (hasLabour) {
      return error(HttpStatus.BAD_REQUEST, 'Labour charges cannot be assigned to a technician');
    }

    // Validate every referenced technician is actually a technician.
    const techIds = [...new Set(assignments.map((a) => a.technicianId))];
    const techRows = await db
      .select({
        id: users.id,
        username: users.username,
        roleSlug: sql<string>`(SELECT slug FROM roles WHERE id = ${users.roleId})`,
      })
      .from(users)
      .where(inArray(users.id, techIds));

    if (techRows.length !== techIds.length) {
      return error(HttpStatus.NOT_FOUND, 'One or more technicians not found');
    }
    const nonTech = techRows.find((t) => t.roleSlug !== 'technician');
    if (nonTech) {
      return error(HttpStatus.BAD_REQUEST, 'One or more selected users are not technicians');
    }

    const actorId = await resolveActorId(request);
    const now = new Date();

    await db.transaction(async (tx: any) => {
      for (const a of assignments) {
        // Evolve labour hours model:
        //   Hours Sold   = Estimated Hours (the quoted/billed hours, known now).
        //   Hours Worked = pending at assignment (0.00); filled from the
        //                  technician's time logs at completion, then re-synced.
        const hoursSold = a.hoursSold ?? a.estimatedHours;
        const hoursWorked = a.hoursWorked ?? 0;
        await tx
          .update(jobCardItems)
          .set({
            assignedTechnicianId: a.technicianId,
            estimatedHours: String(a.estimatedHours),
            hoursWorked: String(hoursWorked),
            hoursSold: String(hoursSold),
            priority: a.priority,
            assignedAt: now,
            assignedBy: actorId,
            updatedAt: now,
          })
          .where(eq(jobCardItems.id, a.itemId));
      }

      // Note: job-card and vehicle status are intentionally NOT touched here.
      // Assignment means the work is scheduled, not started. The technician
      // flips the card to IN_PROGRESS (and vehicle to 'In Service') when
      // they start working via a separate start-work endpoint.
      await tx
        .update(jobCards)
        .set({ updatedAt: now, updatedBy: actorId })
        .where(eq(jobCards.id, id));

      // Audit — Bulk Technician Allocation ("Assign All"), via the existing
      // job-card edit-history mechanism. Only when the FE flags a bulk action.
      if (bulk) {
        const techNames = [...new Set(assignments.map((a) => a.technicianId))]
          .map((tid) => techRows.find((t) => t.id === tid)?.username ?? tid)
          .join(', ');
        await tx.insert(jobCardEditHistory).values({
          jobCardId: id,
          editedBy: actorId,
          estimateAffected: false,
          reconfirmationTriggered: false,
          approvalInvalidated: false,
          fromStatus: jobCard.status,
          toStatus: jobCard.status,
          summary: `Bulk Technician Assignment — ${techNames} → ${assignments.length} labour line(s)`,
        });
      }
    });

    // Post-commit: push the newly-allocated technician labour to Evolve (RO
    // UPDATE → ROJobDetails). Fire-and-forget; gated/idempotent inside, and a
    // no-op unless EVOLVE_LABOUR_LINES_ENABLED. Never blocks the assignment.
    void syncJobCardUpdateToEvolve(id).catch(() => { /* logged inside */ });

    return success('Technicians assigned successfully', {
      jobCardId: id,
      status: jobCard.status,
      assignedCount: assignments.length,
      assignedAt: now.toISOString(),
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Reassign single item to a different technician ────────────────────────
// Soft handover: keeps tech-A's diagnosis / photos / time-logs intact, but
// flips assignedTechnicianId to tech-B and writes an audit row that drives
// the receiving tech's "inheritance" banner. Pauses any open time log so
// tech-A stops accruing labour on a job they no longer own.
export async function reassignItemTechnician(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const body = (request.body ?? {}) as {
      technicianId: string;
      reason?: string;
      overrideSkillWarning?: boolean;
    };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    if (!body.technicianId) return error(HttpStatus.BAD_REQUEST, 'technicianId is required');

    // Load item + parent JC + linked part_request state (for the
    // supplementary-approval guard).
    const [item] = await db
      .select({
        id: jobCardItems.id,
        jobCardId: jobCardItems.jobCardId,
        completedAt: jobCardItems.completedAt,
        assignedTechnicianId: jobCardItems.assignedTechnicianId,
        diagnosisNotes: jobCardItems.diagnosisNotes,
      })
      .from(jobCardItems)
      .where(eq(jobCardItems.id, itemId))
      .limit(1);
    if (!item) return error(HttpStatus.NOT_FOUND, 'Job card item not found');

    // Guard 1 — completed items cannot be reassigned.
    if (item.completedAt) {
      return error(HttpStatus.BAD_REQUEST, 'Item is already completed. Use rework flow if QC failed.');
    }

    // Guard 2 — same-tech no-op.
    if (item.assignedTechnicianId === body.technicianId) {
      return error(HttpStatus.BAD_REQUEST, 'Item is already assigned to this technician.');
    }

    // Guard 3 — block if a tech-raised part_request linked to this item is
    // still awaiting customer approval. Avoids reassigning mid-modification.
    const [pendingPr] = await db
      .select({ id: partRequests.id })
      .from(partRequests)
      .where(and(
        eq(partRequests.jobCardItemId, itemId),
        eq(partRequests.customerApprovalStatus, 'PENDING'),
      ))
      .limit(1);
    if (pendingPr) {
      return error(HttpStatus.BAD_REQUEST, 'Cannot reassign — a part on this item is awaiting customer approval.');
    }

    // Validate target is a technician.
    const [targetTech] = await db
      .select({ id: users.id, username: users.username, roleSlug: sql<string>`(SELECT slug FROM roles WHERE id = ${users.roleId})` })
      .from(users)
      .where(eq(users.id, body.technicianId))
      .limit(1);
    if (!targetTech) return error(HttpStatus.NOT_FOUND, 'Target technician not found');
    if (targetTech.roleSlug !== 'technician') {
      return error(HttpStatus.BAD_REQUEST, 'Target user is not a technician');
    }

    // Lookup the outgoing tech for the audit row + response payload.
    let fromTech: { id: string; username: string } | null = null;
    if (item.assignedTechnicianId) {
      const [u] = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, item.assignedTechnicianId))
        .limit(1);
      if (u) fromTech = u;
    }

    // Compute the outgoing tech's accumulated seconds (so the audit row +
    // FE banner can show "1h 32m of prior work"). Sum of completed
    // time-log durations + any currently-open log (now - startedAt).
    const now = new Date();
    const priorSeconds = item.assignedTechnicianId
      ? await (async () => {
          const logs = await db
            .select({ startedAt: jobCardItemTimeLogs.startedAt, pausedAt: jobCardItemTimeLogs.pausedAt })
            .from(jobCardItemTimeLogs)
            .where(and(
              eq(jobCardItemTimeLogs.jobCardItemId, itemId),
              eq(jobCardItemTimeLogs.technicianId, item.assignedTechnicianId!),
            ));
          return logs.reduce((s, l) => {
            const end = l.pausedAt ? new Date(l.pausedAt as any).getTime() : now.getTime();
            return s + Math.max(0, Math.floor((end - new Date(l.startedAt as any).getTime()) / 1000));
          }, 0);
        })()
      : 0;

    // Reason mandatory when there's work-in-progress (any prior time OR any
    // diagnosis notes OR any photos). Empty items can swap silently.
    const [{ photoCount }] = await db
      .select({ photoCount: count() })
      .from(jobCardItemPhotos)
      .where(eq(jobCardItemPhotos.jobCardItemId, itemId));
    const hasWork = priorSeconds > 0 || !!item.diagnosisNotes || Number(photoCount) > 0;
    if (hasWork && !body.reason?.trim()) {
      return error(HttpStatus.BAD_REQUEST, 'Reason is required when reassigning an item with prior work.');
    }

    let wasTimerPaused = false;
    await db.transaction(async (tx: any) => {
      // Pause any open time log (from the outgoing tech). Tech-A stops
      // clocking labour on a job that's no longer theirs.
      const openLogs = await tx
        .select({ id: jobCardItemTimeLogs.id })
        .from(jobCardItemTimeLogs)
        .where(and(
          eq(jobCardItemTimeLogs.jobCardItemId, itemId),
          isNull(jobCardItemTimeLogs.pausedAt),
        ));
      if (openLogs.length > 0) {
        await tx
          .update(jobCardItemTimeLogs)
          .set({ pausedAt: now })
          .where(and(
            eq(jobCardItemTimeLogs.jobCardItemId, itemId),
            isNull(jobCardItemTimeLogs.pausedAt),
          ));
        wasTimerPaused = true;
      }

      // Flip the assignment fields. assignedAt becomes "now" so the v360
      // timeline shows a fresh ASSIGNMENT event for the new tech.
      await tx
        .update(jobCardItems)
        .set({
          assignedTechnicianId: body.technicianId,
          assignedAt: now,
          assignedBy: actorId,
          updatedAt: now,
        })
        .where(eq(jobCardItems.id, itemId));

      // Audit row — survives forever, drives the receiving tech's banner.
      await tx.insert(jobCardItemReassignments).values({
        jobCardItemId: itemId,
        fromTechId: item.assignedTechnicianId ?? null,
        toTechId: body.technicianId,
        reassignedBy: actorId,
        reason: body.reason?.trim() || null,
        priorSeconds,
      });
    });

    // Post-commit: re-push labour to Evolve so the line's TechNo reflects the
    // new technician (RO UPDATE → ROJobDetails LineStatus=U). Fire-and-forget;
    // gated/idempotent inside, no-op unless EVOLVE_LABOUR_LINES_ENABLED.
    void syncJobCardUpdateToEvolve(item.jobCardId).catch(() => { /* logged inside */ });

    return success('Item reassigned', {
      ok: true,
      itemId,
      fromTech,
      toTech: { id: targetTech.id, username: targetTech.username },
      priorSeconds,
      wasTimerPaused,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Technician Start Work ──────────────────────────────────────────────────
// Called by a technician when they start working on a job card they've been
// assigned to. Flips the job card from APPROVED to IN_PROGRESS and the vehicle
// to 'In Service'. Idempotent — if the card is already IN_PROGRESS, returns
// the current state without re-mutating.
// Work may only begin once a workshop bay has been allocated for the vehicle's
// active visit. The active allocation is the workshop_allocations row for the
// job card's check-in whose released_at is still NULL. Returns false when the
// card has no linked check-in (a bay can't be allocated without one).
async function jobCardHasActiveBay(jobCardId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workshopAllocations.id })
    .from(workshopAllocations)
    .innerJoin(jobCards, eq(jobCards.vehicleCheckInId, workshopAllocations.checkInId))
    .where(and(eq(jobCards.id, jobCardId), isNull(workshopAllocations.releasedAt)))
    .limit(1);
  return !!row;
}

const BAY_REQUIRED_MESSAGE = 'A workshop bay must be allocated before work can start.';

export async function startTechnicianWork(request: FastifyRequest) {
  try {
    const { jobCardId } = request.params as any;
    const actorId = await resolveActorId(request);
    if (!actorId) {
      return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    }

    const [jobCard] = await db
      .select({ id: jobCards.id, status: jobCards.status, vehicleId: jobCards.vehicleId })
      .from(jobCards)
      .where(eq(jobCards.id, jobCardId))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Job card not found');
    }

    // Guard: the logged-in user must be assigned to at least one item.
    const [assignedItem] = await db
      .select({ id: jobCardItems.id })
      .from(jobCardItems)
      .where(and(
        eq(jobCardItems.jobCardId, jobCardId),
        eq(jobCardItems.assignedTechnicianId, actorId),
      ))
      .limit(1);

    if (!assignedItem) {
      return error(HttpStatus.FORBIDDEN, 'You are not assigned to this job card');
    }

    if (jobCard.status === 'IN_PROGRESS') {
      return success('Work already started', {
        jobCardId,
        status: 'IN_PROGRESS',
        vehicleStatus: 'In Service',
      });
    }

    if (jobCard.status !== 'APPROVED') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Work can only be started on APPROVED job cards. Current: ${jobCard.status}`,
      );
    }

    // Guard: a workshop bay must be allocated before work can start.
    if (!(await jobCardHasActiveBay(jobCardId))) {
      return error(HttpStatus.BAD_REQUEST, BAY_REQUIRED_MESSAGE);
    }

    const now = new Date();
    await db.transaction(async (tx: any) => {
      await tx
        .update(jobCards)
        .set({ status: 'IN_PROGRESS', updatedAt: now, updatedBy: actorId })
        .where(eq(jobCards.id, jobCardId));

      await tx
        .update(vehicles)
        .set({ status: 'In Service', updatedAt: now, updatedBy: actorId })
        .where(eq(vehicles.id, jobCard.vehicleId));
    });

    void syncJobCardUpdateToEvolve(jobCardId).catch(() => { /* logged inside */ });

    return success('Work started', {
      jobCardId,
      status: 'IN_PROGRESS',
      vehicleStatus: 'In Service',
      startedAt: now.toISOString(),
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Item-level Time Tracking ───────────────────────────────────────────────
// A "session" is one row in job_card_item_time_logs. While running, paused_at
// is NULL; pausing or completing closes it by setting paused_at. Total time on
// an item = SUM(paused_at - started_at) across all the item's logs.

// Helper: validate that the logged-in user is the technician assigned to the
// given item, and return the item row + technician id.
async function loadItemForTechnician(itemId: string, technicianId: string) {
  const [item] = await db
    .select({
      id: jobCardItems.id,
      jobCardId: jobCardItems.jobCardId,
      assignedTechnicianId: jobCardItems.assignedTechnicianId,
      completedAt: jobCardItems.completedAt,
    })
    .from(jobCardItems)
    .where(eq(jobCardItems.id, itemId))
    .limit(1);
  if (!item) return { error: error(HttpStatus.NOT_FOUND, 'Job item not found') };
  if (item.assignedTechnicianId !== technicianId) {
    return { error: error(HttpStatus.FORBIDDEN, 'You are not assigned to this item') };
  }
  return { item };
}

// Start a session on a job-card item. Auto-pauses any other open session for
// the same technician — a technician can only have one timer running at a time.
export async function startItemWork(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const body = (request.body ?? {}) as { enforce?: boolean };
    const enforce = body.enforce !== false;

    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const res = await loadItemForTechnician(itemId, actorId);
    if (res.error) return res.error;
    if (res.item!.completedAt) {
      return error(HttpStatus.BAD_REQUEST, 'Item is already completed');
    }

    // OEM compliance (Johan 9-June): every job line must have a Cause
    // write-up (diagnosis) recorded before clock-in. Use the existing
    // /diagnosis endpoint to fill it first.
    if (enforce) {
      const [diag] = await db
        .select({ diagnosisNotes: jobCardItems.diagnosisNotes })
        .from(jobCardItems)
        .where(eq(jobCardItems.id, itemId))
        .limit(1);
      if (!diag?.diagnosisNotes || diag.diagnosisNotes.trim().length < 10) {
        return error(
          HttpStatus.BAD_REQUEST,
          'A Cause / diagnosis write-up of at least 10 characters is required before starting.',
        );
      }
    }

    const now = new Date();
    const jobCardId = res.item!.jobCardId;

    // Guard: starting an item is the first thing that flips the card to
    // IN_PROGRESS. If the card is still APPROVED, a bay must be allocated first.
    const [jcPre] = await db
      .select({ status: jobCards.status })
      .from(jobCards)
      .where(eq(jobCards.id, jobCardId))
      .limit(1);
    if (jcPre?.status === 'APPROVED' && !(await jobCardHasActiveBay(jobCardId))) {
      return error(HttpStatus.BAD_REQUEST, BAY_REQUIRED_MESSAGE);
    }

    await db.transaction(async (tx: any) => {
      // Auto-pause any other open session for this technician.
      await tx
        .update(jobCardItemTimeLogs)
        .set({ pausedAt: now })
        .where(
          and(
            eq(jobCardItemTimeLogs.technicianId, actorId),
            isNull(jobCardItemTimeLogs.pausedAt),
          ),
        );

      // Open a new session.
      await tx.insert(jobCardItemTimeLogs).values({
        jobCardItemId: itemId,
        technicianId: actorId,
        startedAt: now,
      });

      // Bump the parent job card to IN_PROGRESS the first time any item starts.
      const [jc] = await tx
        .select({ status: jobCards.status, vehicleId: jobCards.vehicleId })
        .from(jobCards)
        .where(eq(jobCards.id, jobCardId))
        .limit(1);
      if (jc && jc.status === 'APPROVED') {
        await tx
          .update(jobCards)
          .set({ status: 'IN_PROGRESS', updatedAt: now, updatedBy: actorId })
          .where(eq(jobCards.id, jobCardId));
        await tx
          .update(vehicles)
          .set({ status: 'In Service', updatedAt: now, updatedBy: actorId })
          .where(eq(vehicles.id, jc.vehicleId));
      }
    });

    // Soft warning — undispatched parts on this item. Tech can still start
    // (diagnosis / disassembly / adjacent work) but completion is blocked
    // until parts arrive (see completeItemWork guard).
    const undispatched = await db
      .select({ id: partRequests.id, partName: partRequests.partName, status: partRequests.status })
      .from(partRequests)
      .where(and(
        eq(partRequests.jobCardItemId, itemId),
        inArray(partRequests.status, ['pending', 'unavailable']),
      ));
    const warning = undispatched.length > 0
      ? `Parts not yet dispatched: ${undispatched.map((p) => p.partName).join(', ')}. You can start diagnosis but completion will be blocked until parts arrive.`
      : null;

    return success('Item started', { itemId, startedAt: now.toISOString(), warning });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Pause the currently-open session on an item.
export async function pauseItemWork(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const res = await loadItemForTechnician(itemId, actorId);
    if (res.error) return res.error;

    const now = new Date();
    const result = await db
      .update(jobCardItemTimeLogs)
      .set({ pausedAt: now })
      .where(
        and(
          eq(jobCardItemTimeLogs.jobCardItemId, itemId),
          eq(jobCardItemTimeLogs.technicianId, actorId),
          isNull(jobCardItemTimeLogs.pausedAt),
        ),
      )
      .returning({ id: jobCardItemTimeLogs.id });

    if (result.length === 0) {
      return error(HttpStatus.BAD_REQUEST, 'No active session to pause');
    }

    return success('Item paused', { itemId, pausedAt: now.toISOString() });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Phase 3 — Diagnosis ───────────────────────────────────────────────────
// Save (or update) the diagnosis note + stamp diagnosed_at/by. Required
// before Start enables on the FE for non-OTHER repair categories.
export async function saveDiagnosis(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const body = (request.body ?? {}) as { notes?: string };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const res = await loadItemForTechnician(itemId, actorId);
    if (res.error) return res.error;

    const notes = (body.notes ?? '').trim();
    // OEM compliance — keep saving permissible at <10 chars (interim drafts),
    // but the Start guard will reject the work until the field has enough
    // detail. This lets technicians iterate before clocking in.

    const now = new Date();
    await db
      .update(jobCardItems)
      .set({
        diagnosisNotes: notes || null,
        diagnosedAt: now,
        diagnosedBy: actorId,
        updatedAt: now,
      })
      .where(eq(jobCardItems.id, itemId));

    return success('Diagnosis saved', { itemId, diagnosedAt: now.toISOString() });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Phase 3 — Per-item photos (DIAGNOSIS or REPAIR) ───────────────────────
export async function uploadItemPhoto(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const res = await loadItemForTechnician(itemId, actorId);
    if (res.error) return res.error;

    const { file, fields } = await handleSingleFileUpload(request);
    const photoType = (fields.photoType ?? '').toUpperCase();
    const ALLOWED_PHOTO_TYPES = ['DIAGNOSIS', 'REPAIR', 'OLD_PART', 'NEW_PART', 'NEW_PART_FITTED'] as const;
    if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(photoType)) {
      await deleteFile(file.path);
      return error(HttpStatus.BAD_REQUEST, `photoType must be one of: ${ALLOWED_PHOTO_TYPES.join(', ')}`);
    }

    const [row] = await db
      .insert(jobCardItemPhotos)
      .values({
        jobCardItemId: itemId,
        photoType: photoType as 'DIAGNOSIS' | 'REPAIR' | 'OLD_PART' | 'NEW_PART' | 'NEW_PART_FITTED',
        imageUrl: file.path,
        takenBy: actorId,
      })
      .returning();

    return created('Photo uploaded', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function deleteItemPhoto(request: FastifyRequest) {
  try {
    const { photoId } = request.params as any;
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const [photo] = await db
      .select({ id: jobCardItemPhotos.id, itemId: jobCardItemPhotos.jobCardItemId, url: jobCardItemPhotos.imageUrl })
      .from(jobCardItemPhotos)
      .where(eq(jobCardItemPhotos.id, photoId))
      .limit(1);
    if (!photo) return error(HttpStatus.NOT_FOUND, 'Photo not found');

    // Ensure the technician owns the parent item.
    const check = await loadItemForTechnician(photo.itemId, actorId);
    if (check.error) return check.error;

    await db.delete(jobCardItemPhotos).where(eq(jobCardItemPhotos.id, photoId));
    await deleteFile(photo.url);
    return success('Photo deleted', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Phase 3 — Mid-repair parts request ────────────────────────────────────
// Lets the technician raise an additional part_request from the job detail
// screen. Flagged with requested_by_technician so the Parts Manager UI can
// surface it separately from pre-share asks.
export async function requestExtraParts(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const body = request.body as { partName: string; partNumber?: string; quantity?: number };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    if (!body?.partName?.trim()) {
      return error(HttpStatus.BAD_REQUEST, 'partName is required');
    }

    const res = await loadItemForTechnician(itemId, actorId);
    if (res.error) return res.error;

    // Need the job card + vehicle to satisfy FKs on part_requests.
    const [item] = await db
      .select({ jobCardId: jobCardItems.jobCardId })
      .from(jobCardItems)
      .where(eq(jobCardItems.id, itemId))
      .limit(1);
    if (!item) return error(HttpStatus.NOT_FOUND, 'Item not found');

    const [jc] = await db
      .select({ vehicleId: jobCards.vehicleId })
      .from(jobCards)
      .where(eq(jobCards.id, item.jobCardId))
      .limit(1);
    if (!jc) return error(HttpStatus.NOT_FOUND, 'Job card not found');

    const [row] = await db
      .insert(partRequests)
      .values({
        jobCardId: item.jobCardId,
        jobCardItemId: itemId,
        vehicleId: jc.vehicleId,
        partName: body.partName.trim(),
        partNumber: body.partNumber?.trim() || null,
        quantity: body.quantity && body.quantity > 0 ? body.quantity : 1,
        requestedByTechnician: true,
        // Captured for auto-assignment after customer approval: this tech
        // will be set as assignedTechnicianId on the supplementary item.
        requestedBy: actorId,
      })
      .returning();

    return created('Parts request submitted', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Phase 3 — Upload technician signature (PNG data URL) ──────────────────
// FE captures a canvas signature, base64-encodes it, and posts here. We
// strip the data-URL prefix, upload as PNG via the existing S3 helper, and
// stash the resulting URL on the job_card_item row. Item is NOT completed
// here — completeItemWork still validates that signature_image_url is set.
export async function uploadItemSignature(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const body = request.body as { dataUrl: string };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const res = await loadItemForTechnician(itemId, actorId);
    if (res.error) return res.error;

    if (!body?.dataUrl?.startsWith('data:image/')) {
      return error(HttpStatus.BAD_REQUEST, 'dataUrl must be a base64 PNG/JPEG data URL');
    }
    const match = body.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return error(HttpStatus.BAD_REQUEST, 'Invalid data URL');
    const buf = Buffer.from(match[2], 'base64');

    // Upload through the same S3 helper used elsewhere. We import the raw S3
    // client to keep this module isolated; signatures don't need compression.
    const { s3, S3_BUCKET } = await import('../../middleware/s3');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { randomUUID } = await import('node:crypto');
    const ext = match[1] === 'image/jpeg' ? 'jpg' : 'png';
    const key = `uploads/sig-${randomUUID()}.${ext}`;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buf,
      ContentType: match[1],
    }));

    await db
      .update(jobCardItems)
      .set({ signatureImageUrl: key, updatedAt: new Date() })
      .where(eq(jobCardItems.id, itemId));

    return success('Signature saved', { itemId, signatureImageUrl: key });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Mark an item complete. Auto-pauses any open session. Phase 3 hardens the
// completion contract: at least one REPAIR photo + a signature must already
// be on the item, OR the request must provide them inline.
export async function completeItemWork(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const body = (request.body ?? {}) as { notes?: string; enforce?: boolean };
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    // enforce=true (default) requires photos + signature; the SA / admin
    // can bypass with enforce=false if they ever need to force-complete.
    const enforce = body.enforce !== false;

    // OEM compliance (Johan 9-June): every job line must have a
    // Correction write-up at clock-out. Minimum 10 chars to discourage
    // single-word entries. enforce=false (super-admin force-complete)
    // bypasses, same as the photo/signature checks below.
    if (enforce && notes.length < 10) {
      return error(
        HttpStatus.BAD_REQUEST,
        'A Correction write-up of at least 10 characters is required before completing.',
      );
    }

    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const res = await loadItemForTechnician(itemId, actorId);
    if (res.error) return res.error;
    if (res.item!.completedAt) {
      return success('Item already completed', { itemId });
    }

    const now = new Date();
    const jobCardId = res.item!.jobCardId;

    // Phase 3 completion guards.
    if (enforce) {
      const [item] = await db
        .select({
          signatureImageUrl: jobCardItems.signatureImageUrl,
          partsRequired: jobCardItems.partsRequired,
          isWarrantyClaim: jobCardItems.isWarrantyClaim,
        })
        .from(jobCardItems)
        .where(eq(jobCardItems.id, itemId))
        .limit(1);
      if (!item?.signatureImageUrl) {
        return error(HttpStatus.BAD_REQUEST, 'Signature is required before completing');
      }

      // Part-swap evidence — mandatory whenever the item involves a physical
      // part replacement (partsRequired set) or is a warranty claim. Three
      // distinct photos required: old part, new part out of box, new part
      // installed in the vehicle. Skipped for pure-labour items.
      // (Note: legacy REPAIR-type photos remain readable in history but are
      // no longer required — the three part photos cover the same evidence.)
      const requiresPartPhotos = !!item.isWarrantyClaim || !!(item.partsRequired && item.partsRequired.trim().length > 0);
      if (requiresPartPhotos) {
        const need = [
          { type: 'OLD_PART' as const, label: 'old part' },
          { type: 'NEW_PART' as const, label: 'new part' },
          { type: 'NEW_PART_FITTED' as const, label: 'new part fitted' },
        ];
        for (const n of need) {
          const [{ c }] = await db
            .select({ c: count() })
            .from(jobCardItemPhotos)
            .where(and(
              eq(jobCardItemPhotos.jobCardItemId, itemId),
              eq(jobCardItemPhotos.photoType, n.type),
            ));
          if (Number(c) === 0) {
            return error(HttpStatus.BAD_REQUEST, `At least one ${n.label} photo is required before completing`);
          }
        }
      }

      // Supplementary-approval guard: if a part request linked to this item
      // is still awaiting customer approval (PM marked it Available with a
      // unit price → re-shared estimate is in customer's hands), block
      // completion until the customer responds. APPROVED / REJECTED /
      // NOT_REQUIRED all pass.
      const pendingApproval = await db
        .select({ id: partRequests.id, partName: partRequests.partName })
        .from(partRequests)
        .where(and(
          eq(partRequests.jobCardItemId, itemId),
          eq(partRequests.customerApprovalStatus, 'PENDING'),
        ))
        .limit(1);
      if (pendingApproval.length > 0) {
        return error(
          HttpStatus.BAD_REQUEST,
          `Waiting for customer approval on extra part "${pendingApproval[0].partName}". Cannot complete the job until customer responds.`,
        );
      }

      // Hard guard — parts still pending/unavailable cannot be completed.
      // 'available' (PM marked but not dispatched) also blocks: the tech
      // hasn't physically received the part. Only 'dispatched' passes.
      const undispatched = await db
        .select({ id: partRequests.id, partName: partRequests.partName, status: partRequests.status })
        .from(partRequests)
        .where(and(
          eq(partRequests.jobCardItemId, itemId),
          inArray(partRequests.status, ['pending', 'unavailable', 'available']),
        ));
      if (undispatched.length > 0) {
        const stuck = undispatched[0];
        return error(
          HttpStatus.BAD_REQUEST,
          `Cannot complete — "${stuck.partName}" is still ${stuck.status}. Wait for Parts Manager to dispatch the part.`,
        );
      }
    }

    await db.transaction(async (tx: any) => {
      // Close any open session.
      await tx
        .update(jobCardItemTimeLogs)
        .set({ pausedAt: now })
        .where(
          and(
            eq(jobCardItemTimeLogs.jobCardItemId, itemId),
            isNull(jobCardItemTimeLogs.pausedAt),
          ),
        );

      // Actual labour hours = sum of the technician's time-log segments (all now
      // closed). This is the real <HoursWorked> sent to Evolve — known only at
      // completion, which is why assignment posts it as pending (0.00) and the
      // post-commit re-sync below updates the labour line with this value.
      const workLogs = await tx
        .select({ startedAt: jobCardItemTimeLogs.startedAt, pausedAt: jobCardItemTimeLogs.pausedAt })
        .from(jobCardItemTimeLogs)
        .where(eq(jobCardItemTimeLogs.jobCardItemId, itemId));
      const totalSeconds = workLogs.reduce((s: number, l: any) => {
        const end = l.pausedAt ? new Date(l.pausedAt as any).getTime() : now.getTime();
        return s + Math.max(0, Math.floor((end - new Date(l.startedAt as any).getTime()) / 1000));
      }, 0);
      const hoursWorked = (totalSeconds / 3600).toFixed(2);

      // Mark the item complete, attaching the technician's notes if any.
      await tx
        .update(jobCardItems)
        .set({
          completedAt: now,
          completedBy: actorId,
          completionNotes: notes ? notes : null,
          hoursWorked,
          updatedAt: now,
        })
        .where(eq(jobCardItems.id, itemId));

      // If every item on the card is now complete, hand it to the foreman.
      // Exclude LABOUR lines: labour is a costing charge (part_code = 'LABOUR')
      // that is never assigned to or completed by a technician (assignTechnician
      // rejects it), so it can never get a completedAt. Counting it here would
      // leave any job card with a labour line stuck in IN_PROGRESS forever.
      // (NULL partsRequired = a real non-labour line → still counted.)
      const remaining = await tx
        .select({ id: jobCardItems.id })
        .from(jobCardItems)
        .where(
          and(
            eq(jobCardItems.jobCardId, jobCardId),
            isNull(jobCardItems.completedAt),
            sql`(${jobCardItems.partsRequired} IS NULL OR UPPER(${jobCardItems.partsRequired}) <> 'LABOUR')`,
          ),
        );

      if (remaining.length === 0) {
        // Phase 7 — work is technician-done but NOT customer-done. Hand
        // the card to the foreman for sign-off; only after they sign
        // does the card move to COMPLETED and become eligible for QC Out.
        await tx
          .update(jobCards)
          .set({ status: 'FOREMAN_REVIEW', updatedAt: now, updatedBy: actorId })
          .where(eq(jobCards.id, jobCardId));
      }
    });

    // Phase 5 — once the parent job card is fully done, advance the RO
    // status to QC_OUT so the inspector picks it up automatically. Outside
    // the transaction so setRoStatus's own audit / notification side
    // effects run on committed data.
    const [postCheck] = await db
      .select({ jobCardStatus: jobCards.status, vehicleCheckInId: jobCards.vehicleCheckInId })
      .from(jobCards)
      .where(eq(jobCards.id, jobCardId))
      .limit(1);
    if (postCheck?.jobCardStatus === 'COMPLETED' && postCheck.vehicleCheckInId) {
      const { setRoStatus } = await import('../../shared/utils/roStatus');
      await setRoStatus(postCheck.vehicleCheckInId, 'QC_OUT', actorId, 'All job card items completed');
    }

    // Phase 6 — if this item was flagged as a warranty claim, register the
    // removed part in the warranty store so the parts manager can track it.
    try {
      const { autoCreateForCompletedItem } = await import('../warranty/service');
      await autoCreateForCompletedItem({ jobCardItemId: itemId, technicianId: actorId });
    } catch (e) {
      console.log('warranty auto-create failed:', e);
    }

    void syncJobCardUpdateToEvolve(jobCardId).catch(() => { /* logged inside */ });

    return success('Item completed', { itemId, completedAt: now.toISOString() });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Returns the technician's view of a job card with per-item time logs and
// totals. Reuses getJobCard's shape but enriches each item with logs[] and
// totalSeconds. Also exposes job-card-level total.
export async function getTechnicianJobDetail(request: FastifyRequest) {
  try {
    const { jobCardId } = request.params as any;
    const inner = await getJobCard({ ...request, params: { id: jobCardId } } as any);
    if (!(inner as any).success || !(inner as any).data) return inner;
    const payload = (inner as any).data;

    const itemIds = payload.items.map((i: any) => i.id);
    const logs = itemIds.length === 0 ? [] : await db
      .select({
        id: jobCardItemTimeLogs.id,
        itemId: jobCardItemTimeLogs.jobCardItemId,
        technicianId: jobCardItemTimeLogs.technicianId,
        startedAt: jobCardItemTimeLogs.startedAt,
        pausedAt: jobCardItemTimeLogs.pausedAt,
      })
      .from(jobCardItemTimeLogs)
      .where(inArray(jobCardItemTimeLogs.jobCardItemId, itemIds))
      .orderBy(jobCardItemTimeLogs.startedAt);

    const logsByItem = new Map<string, typeof logs>();
    for (const l of logs) {
      const arr = logsByItem.get(l.itemId) ?? [];
      arr.push(l);
      logsByItem.set(l.itemId, arr);
    }

    // Phase 3 — pull per-item diagnosis + repair photos in one query.
    const photos = itemIds.length === 0 ? [] : await db
      .select({
        id: jobCardItemPhotos.id,
        itemId: jobCardItemPhotos.jobCardItemId,
        photoType: jobCardItemPhotos.photoType,
        imageUrl: jobCardItemPhotos.imageUrl,
        takenAt: jobCardItemPhotos.takenAt,
      })
      .from(jobCardItemPhotos)
      .where(inArray(jobCardItemPhotos.jobCardItemId, itemIds))
      .orderBy(jobCardItemPhotos.takenAt);
    const photosByItem = new Map<string, typeof photos>();
    for (const p of photos) {
      const arr = photosByItem.get(p.itemId) ?? [];
      arr.push(p);
      photosByItem.set(p.itemId, arr);
    }

    // Signed S3 URLs for FE rendering.
    const { signUrl } = await import('../../middleware/s3');

    const nowMs = Date.now();
    let cardTotalSeconds = 0;
    const enrichedItems = await Promise.all(payload.items.map(async (item: any) => {
      const itemLogs = (logsByItem.get(item.id) ?? []).map((l) => ({
        id: l.id,
        startedAt: l.startedAt,
        pausedAt: l.pausedAt,
        // For closed sessions, duration is fixed; for running ones, count up to now.
        durationSeconds: Math.max(
          0,
          Math.floor(
            ((l.pausedAt ? new Date(l.pausedAt).getTime() : nowMs) -
              new Date(l.startedAt).getTime()) / 1000,
          ),
        ),
      }));
      const totalSeconds = itemLogs.reduce((sum, l) => sum + l.durationSeconds, 0);
      const isRunning = itemLogs.some((l) => l.pausedAt === null);
      cardTotalSeconds += totalSeconds;

      const itemPhotos = photosByItem.get(item.id) ?? [];
      const signOne = async (p: any) => ({
        id: p.id, takenAt: p.takenAt, imageUrl: await signUrl(p.imageUrl),
      });
      const filterAndSign = (type: string) =>
        Promise.all(itemPhotos.filter((p) => p.photoType === type).map(signOne));
      const [diagnosisPhotos, repairPhotos, oldPartPhotos, newPartPhotos, newPartFittedPhotos] = await Promise.all([
        filterAndSign('DIAGNOSIS'),
        filterAndSign('REPAIR'),
        filterAndSign('OLD_PART'),
        filterAndSign('NEW_PART'),
        filterAndSign('NEW_PART_FITTED'),
      ]);
      const signatureImageUrl = item.signatureImageUrl
        ? await signUrl(item.signatureImageUrl)
        : null;

      // If this item was reassigned, surface the latest hand-over context
      // for the receiving tech's inheritance banner.
      const [latestReassign] = await db
        .select({
          fromTechId: jobCardItemReassignments.fromTechId,
          reassignedBy: jobCardItemReassignments.reassignedBy,
          reason: jobCardItemReassignments.reason,
          priorSeconds: jobCardItemReassignments.priorSeconds,
          reassignedAt: jobCardItemReassignments.reassignedAt,
        })
        .from(jobCardItemReassignments)
        .where(eq(jobCardItemReassignments.jobCardItemId, item.id))
        .orderBy(desc(jobCardItemReassignments.reassignedAt))
        .limit(1);
      let reassignment: any = null;
      if (latestReassign) {
        const [fromU, byU] = await Promise.all([
          latestReassign.fromTechId
            ? db.select({ username: users.username }).from(users).where(eq(users.id, latestReassign.fromTechId)).limit(1)
            : Promise.resolve([{ username: null }]),
          latestReassign.reassignedBy
            ? db.select({ username: users.username }).from(users).where(eq(users.id, latestReassign.reassignedBy)).limit(1)
            : Promise.resolve([{ username: null }]),
        ]);
        reassignment = {
          fromTechUsername: fromU[0]?.username ?? null,
          reassignedByUsername: byU[0]?.username ?? null,
          reassignedAt: latestReassign.reassignedAt,
          reason: latestReassign.reason,
          priorSeconds: latestReassign.priorSeconds,
        };
      }

      // Per-item part_requests summary so the tech UI can render the
      // waiting-for-parts banner and disable Complete without re-fetching.
      const itemPartReqs = await db
        .select({
          id: partRequests.id,
          partName: partRequests.partName,
          partNumber: partRequests.partNumber,
          quantity: partRequests.quantity,
          status: partRequests.status,
          expectedTime: partRequests.expectedTime,
          customerApprovalStatus: partRequests.customerApprovalStatus,
        })
        .from(partRequests)
        .where(eq(partRequests.jobCardItemId, item.id));

      return {
        ...item,
        timeLogs: itemLogs,
        totalSeconds,
        isRunning,
        diagnosisPhotos,
        repairPhotos,
        oldPartPhotos,
        newPartPhotos,
        newPartFittedPhotos,
        signatureImageUrl,
        reassignment,
        partRequests: itemPartReqs,
      };
    }));

    // Bay allocation for the active visit — the tech UI uses this to gate the
    // "Start" action (work can't begin until a bay is allocated).
    let bayAllocated = false;
    let bayNo: string | null = null;
    if (payload.jobCard?.vehicleCheckInId) {
      const [alloc] = await db
        .select({ bayNo: workshopBays.bayNo })
        .from(workshopAllocations)
        .innerJoin(workshopBays, eq(workshopBays.id, workshopAllocations.bayId))
        .where(and(
          eq(workshopAllocations.checkInId, payload.jobCard.vehicleCheckInId),
          isNull(workshopAllocations.releasedAt),
        ))
        .limit(1);
      if (alloc) {
        bayAllocated = true;
        bayNo = alloc.bayNo;
      }
    }

    return success('Job card fetched successfully', {
      ...payload,
      items: enrichedItems,
      totalSeconds: cardTotalSeconds,
      bayAllocated,
      bayNo,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── My Technician Jobs ─────────────────────────────────────────────────────
// Returns ONE row per assigned item (not grouped by job card). Each row carries
// its own status derived from completion + open-timer state, plus the total
// seconds worked so far. This lets the technician dashboard render an item-
// level list / tabs without further client-side grouping.
export async function getMyTechnicianJobs(request: FastifyRequest) {
  try {
    const actorId = await resolveActorId(request);
    if (!actorId) {
      return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    }

    // All items assigned to this technician, with vehicle + job-card context.
    const rows = await db
      .select({
        itemId: jobCardItems.id,
        jobCardId: jobCards.id,
        jobCardStatus: jobCards.status,
        vehicleId: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        jobDescription: jobCardItems.jobDescription,
        estimatedHours: jobCardItems.estimatedHours,
        priority: jobCardItems.priority,
        assignedAt: jobCardItems.assignedAt,
        completedAt: jobCardItems.completedAt,
      })
      .from(jobCardItems)
      .innerJoin(jobCards, eq(jobCards.id, jobCardItems.jobCardId))
      .innerJoin(vehicles, eq(vehicles.id, jobCards.vehicleId))
      .where(
        and(
          eq(jobCardItems.assignedTechnicianId, actorId),
          // Exclude labour lines. Labour is modelled as a catalogue "part" with
          // part_code = 'LABOUR' (amount stored in parts_cost); it is a
          // costing charge, never a technician task.
          sql`UPPER(COALESCE(${jobCardItems.partsRequired}, '')) <> 'LABOUR'`,
        ),
      )
      .orderBy(desc(jobCardItems.assignedAt));

    // Fetch all time logs for these items in one query to compute totals
    // + open-session detection.
    const itemIds = rows.map((r) => r.itemId);
    const logs = itemIds.length === 0
      ? []
      : await db
          .select({
            itemId: jobCardItemTimeLogs.jobCardItemId,
            startedAt: jobCardItemTimeLogs.startedAt,
            pausedAt: jobCardItemTimeLogs.pausedAt,
          })
          .from(jobCardItemTimeLogs)
          .where(inArray(jobCardItemTimeLogs.jobCardItemId, itemIds));

    const nowMs = Date.now();
    const logsByItem = new Map<string, { totalSeconds: number; isRunning: boolean }>();
    for (const l of logs) {
      const acc = logsByItem.get(l.itemId) ?? { totalSeconds: 0, isRunning: false };
      const endMs = l.pausedAt ? new Date(l.pausedAt).getTime() : nowMs;
      acc.totalSeconds += Math.max(0, Math.floor((endMs - new Date(l.startedAt).getTime()) / 1000));
      if (l.pausedAt === null) acc.isRunning = true;
      logsByItem.set(l.itemId, acc);
    }

    type ItemRow = {
      itemId: string;
      jobCardId: string;
      vehicleId: string;
      vehicleNumber: string;
      vehicleModel: string;
      jobDescription: string;
      estimatedHours: string | null;
      priority: string | null;
      assignedAt: Date | null;
      completedAt: Date | null;
      totalSeconds: number;
      isRunning: boolean;
      status: 'pending' | 'progress' | 'completed';
    };

    const items: ItemRow[] = rows.map((r) => {
      const t = logsByItem.get(r.itemId) ?? { totalSeconds: 0, isRunning: false };
      const status: 'pending' | 'progress' | 'completed' = r.completedAt
        ? 'completed'
        : t.isRunning || t.totalSeconds > 0
          ? 'progress'
          : 'pending';
      return {
        itemId: r.itemId,
        jobCardId: r.jobCardId,
        vehicleId: r.vehicleId,
        vehicleNumber: r.registrationNumber ?? '—',
        vehicleModel: `${r.brand} ${r.model}`.trim(),
        jobDescription: r.jobDescription,
        estimatedHours: r.estimatedHours,
        priority: r.priority,
        assignedAt: r.assignedAt,
        completedAt: r.completedAt,
        totalSeconds: t.totalSeconds,
        isRunning: t.isRunning,
        status,
      };
    });

    const stats = {
      pending: items.filter((i) => i.status === 'pending').length,
      inProgress: items.filter((i) => i.status === 'progress').length,
      completed: items.filter((i) => i.status === 'completed').length,
    };

    // Optional server-side pagination + status filter.
    const q = (request.query ?? {}) as { page?: string | number; limit?: string | number; status?: string };
    const paginated = q.page != null || q.limit != null;
    if (!paginated) {
      return success('My technician jobs fetched successfully', { items, stats });
    }

    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;
    const statusFilter = q.status as 'pending' | 'progress' | 'completed' | undefined;
    const filtered = statusFilter ? items.filter((i) => i.status === statusFilter) : items;
    const total = filtered.length;
    const pagedItems = filtered.slice(offset, offset + limit);

    return success('My technician jobs fetched successfully', {
      items: pagedItems,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── List Technicians ───────────────────────────────────────────────────────
// For the Assign modal: returns each active technician with their skill set
// (Phase 3) and current workload (count of active vs completed items).
// FE uses skills[] + repair_category to surface the "Match" chip and sort
// matched techs to the top of the dropdown.
export async function listTechnicians(_request: FastifyRequest) {
  try {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
      })
      .from(users)
      .innerJoin(sql`roles`, sql`roles.id = ${users.roleId}`)
      .where(and(sql`roles.slug = 'technician'`, eq(users.isActive, true)))
      .orderBy(users.username);

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return success('Technicians fetched successfully', []);
    }

    const [skillRows, itemRows] = await Promise.all([
      db
        .select({ techId: technicianSkills.technicianId, skill: technicianSkills.skill })
        .from(technicianSkills)
        .where(inArray(technicianSkills.technicianId, ids)),
      db
        .select({
          techId: jobCardItems.assignedTechnicianId,
          completedAt: jobCardItems.completedAt,
        })
        .from(jobCardItems)
        .where(inArray(jobCardItems.assignedTechnicianId, ids)),
    ]);

    const skillsByTech = new Map<string, string[]>();
    for (const s of skillRows) {
      const arr = skillsByTech.get(s.techId) ?? [];
      arr.push(s.skill as string);
      skillsByTech.set(s.techId, arr);
    }
    const workloadByTech = new Map<string, { active: number; completed: number }>();
    for (const it of itemRows) {
      if (!it.techId) continue;
      const w = workloadByTech.get(it.techId) ?? { active: 0, completed: 0 };
      if (it.completedAt) w.completed += 1;
      else w.active += 1;
      workloadByTech.set(it.techId, w);
    }

    const enriched = rows.map((r) => ({
      ...r,
      skills: skillsByTech.get(r.id) ?? [],
      activeItemCount: workloadByTech.get(r.id)?.active ?? 0,
      completedItemCount: workloadByTech.get(r.id)?.completed ?? 0,
    }));

    return success('Technicians fetched successfully', enriched);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Vehicle Status ──────────────────────────────────────────────────
export async function updateVehicleStatus(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const body = request.body as any;
    const scope = await resolveUserScope(request);
    if (!(await vehicleInShopScope(scope, vehicleId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Valid transitions
    const validTransitions: Record<string, string[]> = {
      'Inspection Done': ['Job Card (Draft)'],
      'Job Card (Draft)': ['Job Card (Pending Cust. Approval)'],
      'Job Card (Pending Cust. Approval)': ['Job Card (Partial Cust. Approval)', 'Job Card (Full Cust. Approval)'],
      'Job Card (Partial Cust. Approval)': ['Job Card (Full Cust. Approval)', 'In Service'],
      'Job Card (Full Cust. Approval)': ['In Service'],
      'In Service': ['Ready for Billing'],
      'Ready for Billing': ['Completed'],
    };

    const allowed = validTransitions[vehicle.status] ?? [];
    if (!allowed.includes(body.status)) {
      return error(
        HttpStatus.BAD_REQUEST,
        `Cannot transition from "${vehicle.status}" to "${body.status}". Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    const actorId = await resolveActorId(request);
    const [updated] = await db
      .update(vehicles)
      .set({ status: body.status, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(vehicles.id, vehicleId))
      .returning({ id: vehicles.id, status: vehicles.status });

    return success(`Vehicle status updated to "${body.status}" successfully`, updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add Service History ────────────────────────────────────────────────────
export async function addServiceHistory(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const body = request.body as any;
    const scope = await resolveUserScope(request);
    if (!(await vehicleInShopScope(scope, vehicleId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    const [record] = await db
      .insert(vehicleServiceHistory)
      .values({
        vehicleId,
        serviceType: body.serviceType,
        serviceDate: body.serviceDate,
        technicianName: body.technicianName ?? null,
        totalCost: body.totalCost?.toFixed(2) ?? null,
        duration: body.duration ?? null,
        notes: body.notes ?? null,
      })
      .returning();

    return created('Service history added successfully', record);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
