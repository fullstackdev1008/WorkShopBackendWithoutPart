import { FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  vehicles,
  vehicleImages,
  vehicleCheckIns,
  customers,
  appointments,
  qcInspections,
  qcInspectionItems,
  qcInspectionPhotos,
  qcChecklistTemplates,
  qcConfirmationComponents,
  qcWorkshopRework,
  users,
} from '../../db/models';
import { resolveUserScope, shopFilter, shopVehicleFilter, checkInInScope } from '../../shared/security/scope';
import {
  qcDashboardQuerySchema,
  createInspectionSchema,
  inspectionIdParamSchema,
  inspectionItemPhotoParamSchema,
  inspectionItemPhotoIdParamSchema,
  saveStepItemsSchema,
  saveFindingsSchema,
  saveConfirmationSchema,
} from './dto';
import { CURRENT_INSPECTION_ORDER_BY } from './currentInspection';
import { handleSingleFileUpload, deleteFile } from '../../shared/upload/upload';
import { signUrl } from '../../middleware/s3';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── Dashboard ──────────────────────────────────────────────────────────────
export async function getDashboard(request: FastifyRequest) {
  try {
    const q = request.query as any;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const { filter, sortOrder, dateFrom, dateTo } = q;
    const offset = (page - 1) * limit;

    // Shop scoping (on top of QC_INSPECTION:view). Two flavours because the
    // dashboard mixes vehicle-centric (queue) and check-in-join (completed)
    // queries: vehShopCond for `.from(vehicles)`, ciShopCond for joins onto
    // vehicle_check_ins. Both undefined for super-admin / ALL. (Stat-card
    // counts left global — see Step 6 note.)
    const scope = await resolveUserScope(request);
    const vehShopCond = shopVehicleFilter(scope);
    const ciShopCond = shopFilter(scope);

    const dateFromVal = dateFrom ? new Date(`${dateFrom}T00:00:00.000`) : undefined;
    const dateToVal = dateTo ? new Date(`${dateTo}T23:59:59.999`) : undefined;

    // Vehicles that should appear in the QC queue
    const queueStatuses = ['Entry (Draft)', 'Vehicle IN', 'Inspection (Draft)', 'Inspection Done'];
    // PENDING = still needs QC work: awaiting inspection or mid-inspection.
    // 'Inspection Done' is deliberately excluded — those belong under Completed.
    const pendingStatuses = ['Entry (Draft)', 'Vehicle IN', 'Inspection (Draft)'];

    // Stats — use query param dates as "selected day", one day prior as "previous day"
    const selectedStart = dateFromVal ?? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
    const selectedEnd   = dateToVal   ?? (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })();

    const prevStart = new Date(selectedStart);
    prevStart.setDate(prevStart.getDate() - 1);
    const prevEnd = new Date(selectedEnd);
    prevEnd.setDate(prevEnd.getDate() - 1);

    // Exclude IRM-pre-imported phantom vehicles that were never actually
    // checked in. A real gate-entered vehicle has entry_time set OR a
    // check-in row.
    // For QC inspection, a vehicle is only "in the queue" if it has physically
    // arrived (entry_time set) OR has been checked in. We deliberately do NOT
    // include vehicles with future BOOKED appointments — those haven't arrived
    // yet, so they're not waiting for QC.
    const hasRealEntry = sql`(
      ${vehicles.entryTime} IS NOT NULL
      OR EXISTS (SELECT 1 FROM vehicle_check_ins ci WHERE ci.vehicle_id = ${vehicles.id})
    )`;

    // Selected day counts — match only vehicles active on the selected date
    // (entered OR updated within the date range), same logic as the queue filter.
    const dateRangeCondition = or(
      and(
        gte(vehicles.entryTime, selectedStart),
        lte(vehicles.entryTime, selectedEnd),
      ),
      and(
        gte(vehicles.updatedAt, selectedStart),
        lte(vehicles.updatedAt, selectedEnd),
      ),
    );

    const [pendingCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, ['Entry (Draft)', 'Vehicle IN']),
          eq(vehicles.isActive, true),
          dateRangeCondition,
          hasRealEntry,
        ),
      );

    const [inProgressCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Inspection (Draft)'),
          eq(vehicles.isActive, true),
          dateRangeCondition,
        ),
      );

    // Completed: count only inspections completed within the selected date range
    const [completedCount] = await db
      .select({ total: count() })
      .from(qcInspections)
      .where(
        and(
          eq(qcInspections.status, 'COMPLETED'),
          gte(qcInspections.completedAt, selectedStart),
          lte(qcInspections.completedAt, selectedEnd),
        ),
      );

    const prevDateRangeCondition = or(
      and(gte(vehicles.entryTime, prevStart), lte(vehicles.entryTime, prevEnd)),
      and(gte(vehicles.updatedAt, prevStart), lte(vehicles.updatedAt, prevEnd)),
    );

    // Previous day counts
    const [pendingYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, ['Entry (Draft)', 'Vehicle IN']),
          eq(vehicles.isActive, true),
          prevDateRangeCondition,
          hasRealEntry,
        ),
      );

    const [inProgressYesterdayCount] = await db
      .select({ total: count() })
      .from(qcInspections)
      .where(
        and(
          eq(qcInspections.status, 'IN_PROGRESS'),
          gte(qcInspections.startedAt, prevStart),
          lte(qcInspections.startedAt, prevEnd),
        ),
      );

    const [completedYesterdayCount] = await db
      .select({ total: count() })
      .from(qcInspections)
      .where(
        and(
          eq(qcInspections.status, 'COMPLETED'),
          gte(qcInspections.completedAt, prevStart),
          lte(qcInspections.completedAt, prevEnd),
        ),
      );

    // Avg inspection time — selected day
    const [avgTimeResult] = await db
      .select({
        avgMinutes: sql<number>`COALESCE(
          EXTRACT(EPOCH FROM AVG(${qcInspections.completedAt} - ${qcInspections.startedAt})) / 60,
          0
        )::int`,
      })
      .from(qcInspections)
      .where(
        and(
          eq(qcInspections.status, 'COMPLETED'),
          gte(qcInspections.completedAt, selectedStart),
          lte(qcInspections.completedAt, selectedEnd),
        ),
      );

    // Avg inspection time — previous day
    const [avgTimeYesterdayResult] = await db
      .select({
        avgMinutes: sql<number>`COALESCE(
          EXTRACT(EPOCH FROM AVG(${qcInspections.completedAt} - ${qcInspections.startedAt})) / 60,
          0
        )::int`,
      })
      .from(qcInspections)
      .where(
        and(
          eq(qcInspections.status, 'COMPLETED'),
          gte(qcInspections.completedAt, prevStart),
          lte(qcInspections.completedAt, prevEnd),
        ),
      );

    const avgMinutes = avgTimeResult?.avgMinutes ?? 0;
    const hours = Math.floor(avgMinutes / 60);
    const mins = avgMinutes % 60;
    const avgTimeInside = avgMinutes > 0 ? `${hours}h ${mins}m` : '0h 0m';

    const avgMinutesYesterday = avgTimeYesterdayResult?.avgMinutes ?? 0;
    const hoursY = Math.floor(avgMinutesYesterday / 60);
    const minsY = avgMinutesYesterday % 60;
    const avgTimeInsideYesterday = avgMinutesYesterday > 0 ? `${hoursY}h ${minsY}m` : '0h 0m';

    // The ONE inspection an active-queue row should carry.
    //
    // vehicle_check_ins → qc_inspections is one-to-many, so joining on
    // vehicle_check_in_id alone matches every inspection the check-in has ever
    // had. A vehicle whose earlier inspection completed and which is now being
    // re-inspected therefore produced TWO queue rows, and the one the planner
    // happened to emit first could carry the COMPLETED inspection's id — the
    // queue then showed "Inspection (Draft)" while Resume/registration opened a
    // finished inspection whose every write the server rejected.
    //
    // Priority is taken from the existing rule in createInspection, which
    // refuses a new inspection while one exists with `status != 'COMPLETED'`:
    // "live" means PENDING or IN_PROGRESS, and at most one can exist per
    // vehicle. So prefer a live inspection; fall back to the newest COMPLETED
    // one, which keeps the registration link opening the last report for a
    // vehicle that has finished QC. Ordering mirrors the completed-history
    // path (newest first) and ends on id so the choice is deterministic even
    // if two rows share a timestamp.
    //
    // Correlated per check-in, so each queue row resolves its own inspection —
    // a global ORDER BY … LIMIT 1 would collapse every row onto one.
    const currentInspectionId = sql`(
      SELECT qi.id
      FROM qc_inspections qi
      WHERE qi.vehicle_check_in_id = ${vehicleCheckIns.id}
      ${sql.raw(CURRENT_INSPECTION_ORDER_BY)}
      LIMIT 1
    )`;

    /// Join condition for the active-queue paths: the check-in's current
    /// inspection only. Left join semantics are preserved — a check-in with no
    /// inspection still yields a row with NULL inspection columns.
    const currentInspectionJoin = and(
      eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id),
      eq(qcInspections.id, currentInspectionId),
    );

    // Query shape shared by both paths
    const selectShape = {
      vehicleId: vehicles.id,
      vehicleCheckInId: vehicleCheckIns.id,
      inspectionId: qcInspections.id,
      registrationNumber: vehicles.registrationNumber,
      brand: vehicles.brand,
      model: vehicles.model,
      vehicleStatus: vehicles.status,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
      customerCompanyName: customers.companyName,
      serviceType: vehicles.serviceType,
      priority: vehicles.priority,
      inspectionStatus: qcInspections.status,
      entryTime: vehicles.entryTime,
      inspectionStartedAt: qcInspections.startedAt,
      inspectionCompletedAt: qcInspections.completedAt,
      frontImage:
        sql<string | null>`(SELECT image_path FROM vehicle_images WHERE vehicle_id = ${vehicles.id} AND image_category = 'Front View' LIMIT 1)`,
    };

    let total: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[];

    // Date filter: match vehicles entered OR updated within the selected range
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

    if (filter === 'COMPLETED') {
      // Completed inspections history — query from qcInspections side
      const completedWhereClause = and(
        eq(qcInspections.status, 'COMPLETED'),
        ...(dateOrCondition ? [dateOrCondition] : []),
        ...(ciShopCond ? [ciShopCond] : []),
      );

      const [countResult] = await db
        .select({ total: count() })
        .from(qcInspections)
        .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
        .innerJoin(vehicles, eq(vehicleCheckIns.vehicleId, vehicles.id))
        .where(completedWhereClause);
      total = countResult.total;

      rows = await db
        .select(selectShape)
        .from(qcInspections)
        .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
        .innerJoin(vehicles, eq(vehicleCheckIns.vehicleId, vehicles.id))
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(completedWhereClause)
        .orderBy(
          sortOrder === 'asc'
            ? sql`${qcInspections.completedAt} ASC`
            : sql`${qcInspections.completedAt} DESC`,
        )
        .limit(limit)
        .offset(offset);
    } else if (filter === 'ALL') {
      // ALL: union of active queue vehicles and completed inspections.
      // The previous implementation joined vehicleCheckIns with isActive=true
      // — but completed visits have isActive=false, so the OR clause for
      // qcInspections.status='COMPLETED' could never fire. Splitting into
      // two queries and merging in JS keeps both lists visible without
      // changing the join semantics for the active-queue query.
      const activeWhere = and(
        inArray(vehicles.status, queueStatuses),
        eq(vehicles.isActive, true),
        hasRealEntry,
        ...(dateOrCondition ? [dateOrCondition] : []),
        ...(vehShopCond ? [vehShopCond] : []),
      );

      const completedWhere = and(
        eq(qcInspections.status, 'COMPLETED'),
        ...(dateOrCondition ? [dateOrCondition] : []),
        ...(ciShopCond ? [ciShopCond] : []),
      );

      // Fetch both sets fully (dataset is bounded by typical day's volume),
      // dedupe by vehicleId (one row per vehicle), sort, then paginate in JS.
      // Active-queue row wins over archived completed rows for the same
      // vehicle. For vehicles with no active row, keep only the most recent
      // completed inspection so prior visits don't pile up.
      const [activeRows, completedRows] = await Promise.all([
        db
          .select(selectShape)
          .from(vehicles)
          .leftJoin(customers, eq(vehicles.customerId, customers.id))
          .leftJoin(
            vehicleCheckIns,
            and(
              eq(vehicleCheckIns.vehicleId, vehicles.id),
              eq(vehicleCheckIns.isActive, true),
            ),
          )
          .leftJoin(qcInspections, currentInspectionJoin)
          .where(activeWhere),
        db
          .select(selectShape)
          .from(qcInspections)
          .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
          .innerJoin(vehicles, eq(vehicleCheckIns.vehicleId, vehicles.id))
          .leftJoin(customers, eq(vehicles.customerId, customers.id))
          .where(completedWhere),
      ]);

      const activeVehicleIds = new Set(activeRows.map((r) => r.vehicleId));

      // For each vehicle without an active queue row, keep only the latest
      // completed inspection (by inspectionCompletedAt) to avoid showing the
      // same vehicle once per prior visit.
      const latestCompletedByVehicle = new Map<string, typeof completedRows[number]>();
      for (const r of completedRows) {
        if (activeVehicleIds.has(r.vehicleId)) continue;
        const prev = latestCompletedByVehicle.get(r.vehicleId);
        const rTime = r.inspectionCompletedAt ? new Date(r.inspectionCompletedAt).getTime() : 0;
        const pTime = prev?.inspectionCompletedAt ? new Date(prev.inspectionCompletedAt).getTime() : -1;
        if (!prev || rTime > pTime) latestCompletedByVehicle.set(r.vehicleId, r);
      }

      const merged = [...activeRows, ...latestCompletedByVehicle.values()];
      merged.sort((a, b) => {
        const ta = new Date(a.entryTime ?? 0).getTime();
        const tb = new Date(b.entryTime ?? 0).getTime();
        return sortOrder === 'asc' ? ta - tb : tb - ta;
      });
      total = merged.length;
      rows = merged.slice(offset, offset + limit);
    } else {
      // PENDING (and the legacy URGENT / DELAYED): active queue vehicles only.
      // PENDING narrows to the not-yet-inspected statuses so a vehicle that has
      // finished QC shows under Completed instead of appearing in both tabs.
      const whereClause = and(
        inArray(vehicles.status, filter === 'PENDING' ? pendingStatuses : queueStatuses),
        eq(vehicles.isActive, true),
        hasRealEntry,
        ...(filter === 'URGENT' ? [eq(vehicles.priority, 'URGENT')] : []),
        ...(dateOrCondition ? [dateOrCondition] : []),
        ...(vehShopCond ? [vehShopCond] : []),
      );

      const [countResult] = await db
        .select({ total: count() })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .leftJoin(
          vehicleCheckIns,
          and(
            eq(vehicleCheckIns.vehicleId, vehicles.id),
            eq(vehicleCheckIns.isActive, true),
          ),
        )
        .leftJoin(qcInspections, currentInspectionJoin)
        .where(whereClause);
      total = countResult.total;

      rows = await db
        .select(selectShape)
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .leftJoin(
          vehicleCheckIns,
          and(
            eq(vehicleCheckIns.vehicleId, vehicles.id),
            eq(vehicleCheckIns.isActive, true),
          ),
        )
        .leftJoin(qcInspections, currentInspectionJoin)
        .where(whereClause)
        .orderBy(
          sortOrder === 'asc'
            ? sql`COALESCE(${vehicles.entryTime}, ${vehicles.updatedAt}) ASC`
            : sql`COALESCE(${vehicles.entryTime}, ${vehicles.updatedAt}) DESC`,
        )
        .limit(limit)
        .offset(offset);
    }

    const now = new Date();
    const queue = await Promise.all(
      rows.map(async (row) => {
        // Calculate inspection duration: startedAt → completedAt (or now if still in progress)
        let waitingTime = '0 Mins';
        if (row.inspectionStartedAt) {
          const start = new Date(row.inspectionStartedAt);
          const end = row.inspectionCompletedAt ? new Date(row.inspectionCompletedAt) : now;
          const diffMs = end.getTime() - start.getTime();
          const diffMins = Math.floor(diffMs / 60000);
          const h = Math.floor(diffMins / 60);
          const m = diffMins % 60;
          waitingTime = h > 0 ? `${h}h ${m}m` : `${m} Mins`;
        }

        return {
          vehicleId: row.vehicleId,
          vehicleCheckInId: row.vehicleCheckInId,
          inspectionId: row.inspectionId,
          // Status of THAT inspection (PENDING | IN_PROGRESS | COMPLETED), as
          // distinct from `status` below, which is the vehicle's. Already in
          // selectShape but never returned, which is why neither client could
          // tell a live inspection from a finished one. Additive: existing
          // fields are untouched and both clients ignore unknown keys.
          inspectionStatus: row.inspectionStatus ?? null,
          registrationNumber: row.registrationNumber,
          brand: row.brand,
          model: row.model,
          customerName:
            row.customerCompanyName ||
            `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim() || null,
          serviceType: row.serviceType
            ? row.serviceType
                .toLowerCase()
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c: string) => c.toUpperCase())
            : null,
          waitingTime,
          status: row.vehicleStatus,
          priority: row.priority ?? 'STANDARD',
          entryTime: row.entryTime,
          frontImage: await signUrl(row.frontImage),
        };
      }),
    );

    return success('QC dashboard data fetched successfully', {
      stats: {
        pendingInspection: pendingCount.total,
        pendingInspectionYesterday: pendingYesterdayCount.total,
        inProgress: inProgressCount.total,
        inProgressYesterday: inProgressYesterdayCount.total,
        completed: completedCount.total,
        completedYesterday: completedYesterdayCount.total,
        avgTimeInside,
        avgTimeInsideYesterday,
      },
      queue,
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

// ─── Create Inspection ──────────────────────────────────────────────────────
export async function createInspection(request: FastifyRequest) {
  try {
    const body = request.body as any;

    // Verify vehicle exists
    const [vehicle] = await db
      .select({
        id: vehicles.id,
        status: vehicles.status,
        odometerLast: vehicles.odometerLast,
      })
      .from(vehicles)
      .where(eq(vehicles.id, body.vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    if (vehicle.status !== 'Vehicle IN') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Vehicle must be in "Vehicle IN" status to start inspection. Current status: ${vehicle.status}`,
      );
    }

    // Check no active inspection exists for this vehicle
    const [existing] = await db
      .select({ id: qcInspections.id })
      .from(qcInspections)
      .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
      .where(
        and(
          eq(vehicleCheckIns.vehicleId, body.vehicleId),
          sql`${qcInspections.status} != 'COMPLETED'`,
        ),
      )
      .limit(1);

    if (existing) {
      return error(HttpStatus.CONFLICT, 'An active inspection already exists for this vehicle');
    }

    const now = new Date();

    // Resolve actor, guarding against tokens whose userId no longer exists
    const rawUserId = (request as any).user?.userId as string | undefined;
    let createdBy: string | null = null;
    if (rawUserId) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, rawUserId)).limit(1);
      createdBy = u?.id ?? null;
    }

    // Transaction: ensure check-in exists, create inspection + items + update vehicle status
    const result = await db.transaction(async (tx: any) => {
      // Find or create an active check-in for this vehicle
      let [checkIn] = await tx
        .select({ id: vehicleCheckIns.id })
        .from(vehicleCheckIns)
        .where(
          and(
            eq(vehicleCheckIns.vehicleId, body.vehicleId),
            eq(vehicleCheckIns.isActive, true),
          ),
        )
        .limit(1);

      if (!checkIn) {
        // Auto-create a check-in
        [checkIn] = await tx
          .insert(vehicleCheckIns)
          .values({
            vehicleId: body.vehicleId,
            odometerReading: vehicle.odometerLast,
            status: 'IN_QUEUE',
            checkInTime: now,
            confirmedAt: now,
            createdBy: createdBy,
            updatedBy: createdBy,
          })
          .returning({ id: vehicleCheckIns.id });
      }

      const [inspection] = await tx
        .insert(qcInspections)
        .values({
          vehicleCheckInId: checkIn.id,
          serviceType: body.serviceType,
          priority: body.priority,
          status: 'IN_PROGRESS',
          currentStep: 1,
          startedAt: now,
          createdBy,
        })
        .returning();

      // Fetch active checklist templates from DB
      const templates = await tx
        .select({
          category: qcChecklistTemplates.category,
          subCategory: qcChecklistTemplates.subCategory,
          itemCode: qcChecklistTemplates.itemCode,
          itemLabel: qcChecklistTemplates.itemLabel,
          sortOrder: qcChecklistTemplates.sortOrder,
        })
        .from(qcChecklistTemplates)
        .where(eq(qcChecklistTemplates.isActive, true))
        .orderBy(asc(qcChecklistTemplates.category), asc(qcChecklistTemplates.sortOrder));

      if (templates.length === 0) {
        throw new Error('No QC checklist templates configured. Please add templates before starting an inspection.');
      }

      const itemValues = templates.map((item: any) => ({
        inspectionId: inspection.id,
        category: item.category as 'EXTERIOR' | 'INTERIOR' | 'BRAKE',
        subCategory: item.subCategory,
        itemCode: item.itemCode,
        itemLabel: item.itemLabel,
        sortOrder: item.sortOrder,
      }));

      const items = await tx
        .insert(qcInspectionItems)
        .values(itemValues)
        .returning();

      // Update vehicle status
      await tx
        .update(vehicles)
        .set({ status: 'Inspection (Draft)', updatedAt: now })
        .where(eq(vehicles.id, body.vehicleId));

      return { inspection, items };
    });

    // Notify customer that QC inspection has started (transparency).
    try {
      const [info] = await db
        .select({
          brand: vehicles.brand,
          model: vehicles.model,
          registrationNumber: vehicles.registrationNumber,
          vin: vehicles.vin,
          customerFirstName: customers.firstName,
          customerLastName: customers.lastName,
          customerCompanyName: customers.companyName,
          customerEmail: customers.primaryEmail,
        })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(eq(vehicles.id, body.vehicleId))
        .limit(1);

      if (info?.customerEmail) {
        const [linkedAppt] = await db
          .select({ bookingRef: appointments.bookingRef })
          .from(appointments)
          .where(eq(appointments.checkInId, result.inspection.vehicleCheckInId))
          .limit(1);

        const { sendQcStartedEmail } = await import('../../services/email.service');
        await sendQcStartedEmail({
          customerName: info.customerCompanyName || `${info.customerFirstName ?? ''} ${info.customerLastName ?? ''}`.trim() || 'Customer',
          customerEmail: info.customerEmail,
          vehicleInfo: `${info.brand} ${info.model} (${info.registrationNumber || info.vin})`,
          bookingRef: linkedAppt?.bookingRef ?? null,
        });
      }
    } catch (e) {
      console.error('[Email] QC started notification failed:', e);
    }

    return created('QC inspection started successfully', result);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Inspection Details ─────────────────────────────────────────────────
export async function getInspectionDetails(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const scope = await resolveUserScope(request);

    // Fetch inspection
    const [inspection] = await db
      .select()
      .from(qcInspections)
      .where(eq(qcInspections.id, id))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'Inspection not found');
    }

    // Fetch vehicle + customer info via check-in
    const [vehicleRow] = await db
      .select({
        vehicleId: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        vin: vehicles.vin,
        shop: vehicleCheckIns.shop,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerCompanyName: customers.companyName,
      })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicleCheckIns.vehicleId, vehicles.id))
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(eq(vehicleCheckIns.id, inspection.vehicleCheckInId))
      .limit(1);

    // Shop scope (IDOR guard).
    if (!checkInInScope(scope, (vehicleRow?.shop as any) ?? null)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this inspection belongs to another shop.');
    }

    // Vehicle front image (prefer FRONT category, fall back to any image)
    let vehicleImageUrl: string | null = null;
    if (vehicleRow?.vehicleId) {
      const imageRows = await db
        .select({ imagePath: vehicleImages.imagePath, imageCategory: vehicleImages.imageCategory })
        .from(vehicleImages)
        .where(eq(vehicleImages.vehicleId, vehicleRow.vehicleId));
      const front =
        imageRows.find((i) => (i.imageCategory ?? '').toUpperCase() === 'FRONT') ?? imageRows[0];
      if (front?.imagePath) {
        vehicleImageUrl = await signUrl(front.imagePath);
      }
    }

    // Fetch appointment linked to this check-in (for complaints / service type).
    // First try the direct link via appointments.checkInId. If missing (older
    // check-ins created before the link was wired up), fall back to the most
    // recent appointment for the same vehicle.
    const apptColumns = {
      id: appointments.id,
      bookingRef: appointments.bookingRef,
      serviceType: appointments.serviceType,
      complaints: appointments.complaints,
      appointmentDate: appointments.appointmentDate,
      appointmentTime: appointments.appointmentTime,
    };

    let [appointmentRow] = await db
      .select(apptColumns)
      .from(appointments)
      .where(eq(appointments.checkInId, inspection.vehicleCheckInId))
      .limit(1);

    if (!appointmentRow && vehicleRow) {
      const [checkInVehicle] = await db
        .select({ vehicleId: vehicleCheckIns.vehicleId })
        .from(vehicleCheckIns)
        .where(eq(vehicleCheckIns.id, inspection.vehicleCheckInId))
        .limit(1);

      if (checkInVehicle) {
        [appointmentRow] = await db
          .select(apptColumns)
          .from(appointments)
          .where(eq(appointments.vehicleId, checkInVehicle.vehicleId))
          .orderBy(desc(appointments.createdAt))
          .limit(1);
      }
    }

    // Fetch all items
    const items = await db
      .select()
      .from(qcInspectionItems)
      .where(eq(qcInspectionItems.inspectionId, id))
      .orderBy(qcInspectionItems.sortOrder);

    // Fetch all photos for these items
    const itemIds = items.map((i: any) => i.id);
    let photos: { id: string; inspectionItemId: string; imageUrl: string; createdAt: Date }[] = [];
    if (itemIds.length > 0) {
      photos = await db
        .select()
        .from(qcInspectionPhotos)
        .where(
          sql`${qcInspectionPhotos.inspectionItemId} IN (${sql.join(
            itemIds.map((id: any) => sql`${id}`),
            sql`, `,
          )})`,
        );
    }

    // Sign photo URLs
    const signedPhotos = await Promise.all(
      photos.map(async (p) => ({ ...p, imageUrl: await signUrl(p.imageUrl) })),
    );

    // Group items by category with photos
    const photosByItemId = new Map<string, typeof signedPhotos>();
    for (const photo of signedPhotos) {
      const arr = photosByItemId.get(photo.inspectionItemId) ?? [];
      arr.push(photo);
      photosByItemId.set(photo.inspectionItemId, arr);
    }

    // Categories are DYNAMIC since 0060_qc_truck_checklist (category widened
    // from the qc_category enum to varchar; the truck sheet uses Engine,
    // Cooling System, Rear of Cab, …). Seed the three legacy keys so older
    // clients reading categories.EXTERIOR still get an array instead of
    // undefined, then create any other bucket on demand.
    const categories: Record<string, any[]> = {
      EXTERIOR: [],
      INTERIOR: [],
      BRAKE: [],
    };

    let passCount = 0;
    let failCount = 0;
    let naCount = 0;
    let pendingCount = 0;
    const failedItems: any[] = [];

    for (const item of items) {
      const itemPhotos = photosByItemId.get(item.id) ?? [];

      if (!categories[item.category]) categories[item.category] = [];
      categories[item.category].push({
        id: item.id,
        itemCode: item.itemCode,
        itemLabel: item.itemLabel,
        subCategory: item.subCategory,
        sortOrder: item.sortOrder,
        result: item.result,
        comment: item.comment,
        photos: itemPhotos,
      });

      if (item.result === 'PASS') passCount++;
      else if (item.result === 'FAIL') {
        failCount++;
        failedItems.push({
          itemCode: item.itemCode,
          itemLabel: item.itemLabel,
          category: item.category,
          comment: item.comment,
        });
      } else if (item.result === 'NA') naCount++;
      else pendingCount++;
    }

    // Resolve the actor UUIDs to usernames so the QC report can show WHO ran
    // and signed off the inspection without a second round-trip per id.
    const actorIds = [inspection.createdBy, inspection.completedBy].filter(
      (x): x is string => !!x,
    );
    const actorNameById = new Map<string, string>();
    if (actorIds.length > 0) {
      const actorRows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, [...new Set(actorIds)]));
      for (const a of actorRows) actorNameById.set(a.id, a.username);
    }

    return success('Inspection details fetched successfully', {
      inspection: {
        ...inspection,
        createdByName: inspection.createdBy ? actorNameById.get(inspection.createdBy) ?? null : null,
        completedByName: inspection.completedBy ? actorNameById.get(inspection.completedBy) ?? null : null,
      },
      vehicle: vehicleRow
        ? {
            ...vehicleRow,
            customerName:
              vehicleRow.customerCompanyName ||
              `${vehicleRow.customerFirstName ?? ''} ${vehicleRow.customerLastName ?? ''}`.trim(),
            imageUrl: vehicleImageUrl,
          }
        : null,
      appointment: appointmentRow ?? null,
      categories,
      summary: {
        totalItems: items.length,
        passCount,
        failCount,
        naCount,
        pendingCount,
      },
      findings: {
        overallStatus: inspection.overallStatus,
        overrideJustification: inspection.overrideJustification,
        finalRemarks: inspection.finalRemarks,
        brakeTestSummary: {
          performance: inspection.brakePerformance,
          noise: inspection.brakeNoise,
          vibration: inspection.brakeVibration,
        },
        failedItems,
        criticalIssuesDetected: failCount > 0,
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Save Step Items ────────────────────────────────────────────────────────
export async function saveStepItems(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    // Verify inspection exists and is IN_PROGRESS
    const [inspection] = await db
      .select({ id: qcInspections.id, status: qcInspections.status })
      .from(qcInspections)
      .where(eq(qcInspections.id, id))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'Inspection not found');
    }

    if (inspection.status !== 'IN_PROGRESS') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Inspection must be IN_PROGRESS to save items. Current status: ${inspection.status}`,
      );
    }

    // Verify all items belong to this inspection and category
    const existingItems = await db
      .select({ id: qcInspectionItems.id, category: qcInspectionItems.category })
      .from(qcInspectionItems)
      .where(
        and(
          eq(qcInspectionItems.inspectionId, id),
          eq(qcInspectionItems.category, body.category),
        ),
      );

    const existingItemIds = new Set(existingItems.map((i: any) => i.id));
    for (const item of body.items) {
      if (!existingItemIds.has(item.itemId)) {
        return error(
          HttpStatus.BAD_REQUEST,
          `Item ${item.itemId} does not belong to this inspection or category`,
        );
      }
    }

    // Validate: failed items must have at least one photo
    const failedItemIds = body.items
      .filter((item: any) => item.result === 'FAIL')
      .map((item: any) => item.itemId);

    if (failedItemIds.length > 0) {
      const photoCounts = await db
        .select({
          inspectionItemId: qcInspectionPhotos.inspectionItemId,
          photoCount: count(qcInspectionPhotos.id),
        })
        .from(qcInspectionPhotos)
        .where(
          sql`${qcInspectionPhotos.inspectionItemId} IN (${sql.join(
            failedItemIds.map((id: any) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .groupBy(qcInspectionPhotos.inspectionItemId);

      const photoCountMap = new Map(
        photoCounts.map((p: any) => [p.inspectionItemId, p.photoCount]),
      );

      const missingPhotos = failedItemIds.filter(
        (id: any) => !photoCountMap.has(id) || photoCountMap.get(id) === 0,
      );

      if (missingPhotos.length > 0) {
        return error(HttpStatus.BAD_REQUEST, 'Photo is required for all failed inspection items');
      }
    }

    // Batch update items and advance step. Only the three legacy car
    // categories map to a fixed wizard step; the truck sheet's dynamic
    // categories (0060) have no such mapping, so leave currentStep alone
    // rather than writing undefined and silently stalling the wizard.
    const stepMap: Record<string, number> = {
      EXTERIOR: 2,
      INTERIOR: 3,
      BRAKE: 4,
    };
    const nextStep = stepMap[body.category];

    await db.transaction(async (tx: any) => {
      for (const item of body.items) {
        await tx
          .update(qcInspectionItems)
          .set({
            result: item.result,
            comment: item.comment ?? null,
            updatedAt: new Date(),
          })
          .where(eq(qcInspectionItems.id, item.itemId));
      }

      // Advance to next step (legacy categories only — see nextStep above).
      await tx
        .update(qcInspections)
        .set({
          ...(nextStep !== undefined ? { currentStep: nextStep } : {}),
          updatedAt: new Date(),
        })
        .where(eq(qcInspections.id, id));
    });

    // Fetch all items with photos (same as getInspectionDetails)
    const allItems = await db
      .select()
      .from(qcInspectionItems)
      .where(eq(qcInspectionItems.inspectionId, id))
      .orderBy(qcInspectionItems.sortOrder);

    const itemIds = allItems.map((i: any) => i.id);
    let photos: { id: string; inspectionItemId: string; imageUrl: string; createdAt: Date }[] = [];
    if (itemIds.length > 0) {
      photos = await db
        .select()
        .from(qcInspectionPhotos)
        .where(
          sql`${qcInspectionPhotos.inspectionItemId} IN (${sql.join(
            itemIds.map((id: any) => sql`${id}`),
            sql`, `,
          )})`,
        );
    }

    // Sign photo URLs
    const signedPhotos = await Promise.all(
      photos.map(async (p) => ({ ...p, imageUrl: await signUrl(p.imageUrl) })),
    );

    const photosByItemId = new Map<string, typeof signedPhotos>();
    for (const photo of signedPhotos) {
      const arr = photosByItemId.get(photo.inspectionItemId) ?? [];
      arr.push(photo);
      photosByItemId.set(photo.inspectionItemId, arr);
    }

    // Dynamic categories — see the note in getInspectionDetails. This is the
    // site that threw "Cannot read properties of undefined (reading 'push')"
    // for any inspection seeded from the truck checklist.
    const categories: Record<string, any[]> = {
      EXTERIOR: [],
      INTERIOR: [],
      BRAKE: [],
    };

    let passCount = 0, failCount = 0, naCount = 0, pendingCount = 0;

    for (const item of allItems) {
      const itemPhotos = photosByItemId.get(item.id) ?? [];

      if (!categories[item.category]) categories[item.category] = [];
      categories[item.category].push({
        id: item.id,
        itemCode: item.itemCode,
        itemLabel: item.itemLabel,
        subCategory: item.subCategory,
        sortOrder: item.sortOrder,
        result: item.result,
        comment: item.comment,
        photos: itemPhotos,
      });

      if (item.result === 'PASS') passCount++;
      else if (item.result === 'FAIL') failCount++;
      else if (item.result === 'NA') naCount++;
      else pendingCount++;
    }

    return success(
      `${body.category.charAt(0) + body.category.slice(1).toLowerCase()} inspection saved successfully`,
      {
        currentStep: stepMap[body.category],
        categories,
        summary: { totalItems: allItems.length, passCount, failCount, naCount, pendingCount },
      },
    );
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Upload Item Photo ──────────────────────────────────────────────────────
export async function uploadItemPhoto(request: FastifyRequest) {
  try {
    const { inspectionId, itemId } = request.params as any;

    // Verify inspection exists
    const [inspection] = await db
      .select({ id: qcInspections.id, status: qcInspections.status })
      .from(qcInspections)
      .where(eq(qcInspections.id, inspectionId))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'Inspection not found');
    }

    // Verify item belongs to this inspection
    const [item] = await db
      .select({ id: qcInspectionItems.id })
      .from(qcInspectionItems)
      .where(
        and(
          eq(qcInspectionItems.id, itemId),
          eq(qcInspectionItems.inspectionId, inspectionId),
        ),
      )
      .limit(1);

    if (!item) {
      return error(HttpStatus.NOT_FOUND, 'Inspection item not found');
    }

    // Upload the file
    let uploadedFile;
    try {
      const result = await handleSingleFileUpload(request);
      uploadedFile = result.file;
    } catch (err: any) {
      return error(HttpStatus.BAD_REQUEST, err.message);
    }

    const [newPhoto] = await db
      .insert(qcInspectionPhotos)
      .values({
        inspectionItemId: itemId,
        imageUrl: uploadedFile.path,
      })
      .returning();

    // Count total photos for this item
    const [{ total: photoCount }] = await db
      .select({ total: count() })
      .from(qcInspectionPhotos)
      .where(eq(qcInspectionPhotos.inspectionItemId, itemId));

    return created('Photo uploaded successfully', {
      photo: { ...newPhoto, imageUrl: await signUrl(newPhoto.imageUrl) },
      photoCount,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Item Photo ──────────────────────────────────────────────────────
export async function deleteItemPhoto(request: FastifyRequest) {
  try {
    const { inspectionId, itemId, photoId } = request.params as any;

    // Verify the photo exists and belongs to the correct item/inspection
    const [photo] = await db
      .select({
        id: qcInspectionPhotos.id,
        imageUrl: qcInspectionPhotos.imageUrl,
        itemInspectionId: qcInspectionItems.inspectionId,
      })
      .from(qcInspectionPhotos)
      .innerJoin(
        qcInspectionItems,
        eq(qcInspectionPhotos.inspectionItemId, qcInspectionItems.id),
      )
      .where(
        and(
          eq(qcInspectionPhotos.id, photoId),
          eq(qcInspectionPhotos.inspectionItemId, itemId),
          eq(qcInspectionItems.inspectionId, inspectionId),
        ),
      )
      .limit(1);

    if (!photo) {
      return error(HttpStatus.NOT_FOUND, 'Photo not found');
    }

    await db
      .delete(qcInspectionPhotos)
      .where(eq(qcInspectionPhotos.id, photoId));

    await deleteFile(photo.imageUrl);

    return success('Photo deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Save Findings ──────────────────────────────────────────────────────────
export async function saveFindings(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [inspection] = await db
      .select({ id: qcInspections.id, status: qcInspections.status })
      .from(qcInspections)
      .where(eq(qcInspections.id, id))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'Inspection not found');
    }

    if (inspection.status !== 'IN_PROGRESS') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Inspection must be IN_PROGRESS to save findings. Current status: ${inspection.status}`,
      );
    }

    const [updated] = await db
      .update(qcInspections)
      .set({
        brakePerformance: body.brakePerformance ?? null,
        brakeNoise: body.brakeNoise ?? null,
        brakeVibration: body.brakeVibration ?? null,
        overallStatus: body.overallStatus,
        overrideJustification: body.overrideJustification ?? null,
        finalRemarks: body.finalRemarks ?? null,
        currentStep: 5,
        updatedAt: new Date(),
      })
      .where(eq(qcInspections.id, id))
      .returning();

    return success('Findings saved successfully', {
      inspection: updated,
      currentStep: 5,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Save Final Confirmation ────────────────────────────────────────────────
export async function saveConfirmation(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [inspection] = await db
      .select({ id: qcInspections.id, status: qcInspections.status })
      .from(qcInspections)
      .where(eq(qcInspections.id, id))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'Inspection not found');
    }

    if (inspection.status !== 'IN_PROGRESS') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Inspection must be IN_PROGRESS to save confirmation. Current status: ${inspection.status}`,
      );
    }

    await db.transaction(async (tx: any) => {
      // Upsert components: delete old, insert new
      await tx.delete(qcConfirmationComponents).where(eq(qcConfirmationComponents.inspectionId, id));
      if (body.components && body.components.length > 0) {
        await tx.insert(qcConfirmationComponents).values(
          body.components.map((c: any, i: number) => ({
            inspectionId: id,
            majorComponent: c.majorComponent ?? null,
            itemNumber: c.itemNumber ?? null,
            comment: c.comment ?? null,
            sortOrder: i,
          })),
        );
      }

      // Upsert rework: delete old, insert new
      await tx.delete(qcWorkshopRework).where(eq(qcWorkshopRework.inspectionId, id));
      if (body.rework) {
        await tx.insert(qcWorkshopRework).values({
          inspectionId: id,
          majorComponent: body.rework.majorComponent ?? null,
          technician: body.rework.technician ?? null,
          itemNumber: body.rework.itemNumber ?? null,
          comments: body.rework.comments ?? null,
        });
      }

      // Update time_in / time_out
      await tx
        .update(qcInspections)
        .set({
          timeIn: body.timeIn ? new Date(body.timeIn) : undefined,
          timeOut: body.timeOut ? new Date(body.timeOut) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(qcInspections.id, id));
    });

    return success('Final confirmation saved successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Upload Signature ───────────────────────────────────────────────────────
export async function uploadSignature(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [inspection] = await db
      .select({ id: qcInspections.id, status: qcInspections.status, signatureUrl: qcInspections.signatureUrl })
      .from(qcInspections)
      .where(eq(qcInspections.id, id))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'Inspection not found');
    }

    if (inspection.status !== 'IN_PROGRESS') {
      return error(HttpStatus.BAD_REQUEST, 'Inspection must be IN_PROGRESS to upload signature.');
    }

    const uploaded = await handleSingleFileUpload(request);

    // Delete old signature if exists
    if (inspection.signatureUrl) {
      await deleteFile(inspection.signatureUrl).catch(() => {});
    }

    const s3Key = uploaded.file.path;

    await db
      .update(qcInspections)
      .set({ signatureUrl: s3Key, updatedAt: new Date() })
      .where(eq(qcInspections.id, id));

    const signedUrl = await signUrl(s3Key);

    return success('Signature uploaded successfully', { signatureUrl: signedUrl });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Submit Inspection ──────────────────────────────────────────────────────
export async function submitInspection(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    // Fetch inspection with vehicle info
    const [inspection] = await db
      .select({
        id: qcInspections.id,
        status: qcInspections.status,
        overallStatus: qcInspections.overallStatus,
        signatureUrl: qcInspections.signatureUrl,
        vehicleCheckInId: qcInspections.vehicleCheckInId,
      })
      .from(qcInspections)
      .where(eq(qcInspections.id, id))
      .limit(1);

    if (!inspection) {
      return error(HttpStatus.NOT_FOUND, 'Inspection not found');
    }

    if (inspection.status !== 'IN_PROGRESS') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Inspection must be IN_PROGRESS to submit. Current status: ${inspection.status}`,
      );
    }

    if (!inspection.overallStatus) {
      return error(
        HttpStatus.BAD_REQUEST,
        'Findings must be saved before submitting. Overall status is required.',
      );
    }

    if (!inspection.signatureUrl) {
      return error(
        HttpStatus.BAD_REQUEST,
        'Technician signature is required before submitting.',
      );
    }

    // Get vehicle ID from check-in
    const [checkIn] = await db
      .select({
        vehicleId: vehicleCheckIns.vehicleId,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
      })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicleCheckIns.vehicleId, vehicles.id))
      .where(eq(vehicleCheckIns.id, inspection.vehicleCheckInId))
      .limit(1);

    const completedAt = new Date();

    // Resolve actor, guarding against tokens whose userId no longer exists
    const rawUserId = (request as any).user?.userId as string | undefined;
    let userId: string | null = null;
    if (rawUserId) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, rawUserId)).limit(1);
      userId = u?.id ?? null;
    }

    await db.transaction(async (tx: any) => {
      // Mark inspection as completed
      await tx
        .update(qcInspections)
        .set({
          status: 'COMPLETED',
          completedAt,
          updatedAt: completedAt,
          completedBy: userId,
        })
        .where(eq(qcInspections.id, id));

      // Update vehicle status
      await tx
        .update(vehicles)
        .set({ status: 'Inspection Done', updatedAt: completedAt, updatedBy: userId })
        .where(eq(vehicles.id, checkIn.vehicleId));
    });

    // Notify customer that QC has completed (transparency).
    try {
      const [info] = await db
        .select({
          customerFirstName: customers.firstName,
          customerLastName: customers.lastName,
          customerCompanyName: customers.companyName,
          customerEmail: customers.primaryEmail,
        })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(eq(vehicles.id, checkIn.vehicleId))
        .limit(1);

      if (info?.customerEmail) {
        const [linkedAppt] = await db
          .select({ bookingRef: appointments.bookingRef })
          .from(appointments)
          .where(eq(appointments.checkInId, inspection.vehicleCheckInId))
          .limit(1);

        const { sendQcCompletedEmail } = await import('../../services/email.service');
        await sendQcCompletedEmail({
          customerName: info.customerCompanyName || `${info.customerFirstName ?? ''} ${info.customerLastName ?? ''}`.trim() || 'Customer',
          customerEmail: info.customerEmail,
          vehicleInfo: `${checkIn.brand} ${checkIn.model} (${checkIn.registrationNumber})`,
          bookingRef: linkedAppt?.bookingRef ?? null,
        });
      }
    } catch (e) {
      console.error('[Email] QC completed notification failed:', e);
    }

    return success('QC report submitted successfully', {
      inspectionId: inspection.id,
      vehicleCheckInId: inspection.vehicleCheckInId,
      registrationNumber: checkIn.registrationNumber,
      vehicleModel: `${checkIn.brand} ${checkIn.model}`,
      overallStatus: inspection.overallStatus,
      completedAt: completedAt.toISOString(),
      vehicleStatus: 'Inspection Done',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Next Vehicle ───────────────────────────────────────────────────────
export async function getNextVehicle(request: FastifyRequest) {
  try {
    // Shop scoping (R4) — restrict the "next vehicle" to the caller's shop.
    const scope = await resolveUserScope(request);
    // Find the next vehicle (In Queue or Ready) that has no active inspection
    const [next] = await db
      .select({
        vehicleId: vehicles.id,
        vehicleCheckInId: vehicleCheckIns.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        entryTime: vehicles.entryTime,
      })
      .from(vehicles)
      .leftJoin(
        vehicleCheckIns,
        and(
          eq(vehicleCheckIns.vehicleId, vehicles.id),
          eq(vehicleCheckIns.isActive, true),
        ),
      )
      .leftJoin(qcInspections, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
      .where(
        and(
          inArray(vehicles.status, ['Entry (Draft)', 'Vehicle IN']),
          eq(vehicles.isActive, true),
          isNull(qcInspections.id),
          shopVehicleFilter(scope),
        ),
      )
      .orderBy(sql`${vehicles.entryTime} ASC`)
      .limit(1);

    if (!next) {
      return success('No vehicles in queue', null);
    }

    const now = new Date();
    const diffMs = now.getTime() - new Date(next.entryTime!).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;

    return success('Next vehicle fetched successfully', {
      vehicleId: next.vehicleId,
      vehicleCheckInId: next.vehicleCheckInId,
      registrationNumber: next.registrationNumber,
      brand: next.brand,
      model: next.model,
      waitingTime: h > 0 ? `${h}h ${m}m` : `${m} Mins`,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
