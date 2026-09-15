import { FastifyRequest } from 'fastify';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../../db';
import {
  appointments,
  customerContacts,
  customers,
  jobCards,
  jobCardItems,
  jobCardItemTimeLogs,
  qcInspections,
  vehicleCheckInPhotos,
  vehicleCheckIns,
  vehicleImages,
  vehicleMakes,
  vehicleModels,
  vehicleModelCodes,
  vehicles,
  users,
  gatePasses,
} from '../../db/models';
import {
  addVehicleSchema,
  updateVehicleSchema,
  vehicleListQuerySchema,
  vehicleIdParamSchema,
  vehicleSearchQuerySchema,
  addMakeSchema,
  addModelSchema,
  makeIdParamSchema,
} from './dto';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { deleteFile, handleSingleFileUpload } from '../../shared/upload/upload';
import { signUrl } from '../../middleware/s3';
import { extractVinAndOdometer } from '../../services/vehicleOcr.service';
import { fetchSeriesForMake, fetchModelCodesForSeries } from '../../services/masterDataSync.service';
import { lookupVehicleByVin, lookupCustomer } from '../../services/evolveIrm.service';
import { companyResolver } from '../../services/companyResolver.service';
import { persistEvolveCustomer } from '../../services/evolveCustomerPersist.service';
import { resolveAndPersistModelCode } from '../../services/vehicleModelCode.service';
import { resolveActorId } from '../../shared/utils/resolveActor';

// ─── Add Vehicle ──────────────────────────────────────────────────────────────
export async function addVehicle(request: FastifyRequest) {
  try {
    const data = request.body as any;

    // Verify customer exists (if provided)
    if (data.customerId) {
      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, data.customerId))
        .limit(1);

      if (!customer) {
        return error(HttpStatus.NOT_FOUND, 'Customer not found');
      }
    }

    // Only block if an *active* (non-archived) entry exists for this VIN.
    // Archived rows are retained history from prior visits and don't count.
    const [existingVin] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.vin, data.vin), ne(vehicles.status, 'Archived')))
      .limit(1);

    if (existingVin) {
      return error(HttpStatus.CONFLICT, 'VIN already has an active entry');
    }

    // Same uniqueness rule for registrationNumber against non-archived vehicles.
    if (data.registrationNumber) {
      const [existingReg] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.registrationNumber, data.registrationNumber),
            ne(vehicles.status, 'Archived'),
          ),
        )
        .limit(1);

      if (existingReg) {
        return error(HttpStatus.CONFLICT, 'Registration number already has an active entry');
      }
    }

    const rawUserId = (request as any).user?.userId as string | undefined;
    let actorId: string | null = null;
    if (rawUserId) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, rawUserId)).limit(1);
      actorId = u?.id ?? null;
    }

    const [newVehicle] = await db
      .insert(vehicles)
      .values({
        ...data,
        status: 'Entry (Draft)',
        createdBy: actorId,
      })
      .returning();

    // Resolve + persist the Evolve ModelCode (fill-blanks-only; mode-gated;
    // inert when EVOLVE_MODELCODE_MODE=OFF). Fire-and-forget; never blocks.
    void resolveAndPersistModelCode(newVehicle.id).catch(() => { /* logged inside */ });

    return created('Vehicle added successfully', newVehicle);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Search Vehicle by VIN ────────────────────────────────────────────────────
export async function searchVehicle(request: FastifyRequest) {
  try {
    const { vin } = request.query as any;

    const rows = await db
      .select()
      .from(vehicles)
      .where(
        and(
          or(
            ilike(vehicles.vin, `%${vin}%`),
            ilike(vehicles.registrationNumber, `%${vin}%`),
          ),
          // Exclude IRM-imported phantoms that never came through the gate.
          // Re-entry / appointment-first logic should only see real visits.
          sql`(
            ${vehicles.entryTime} IS NOT NULL
            OR EXISTS (SELECT 1 FROM vehicle_check_ins ci WHERE ci.vehicle_id = ${vehicles.id})
            OR EXISTS (SELECT 1 FROM appointments a WHERE a.vehicle_id = ${vehicles.id} AND a.deleted_at IS NULL AND a.status IN ('BOOKED','CONFIRMED'))
          )`,
        ),
      )
      .limit(20);

    // Look up active check-ins for the matched vehicles in one query so the
    // frontend can warn / block re-entry before the user fills the form.
    const vehicleIds = rows.map((v: any) => v.id);
    let activeByVehicleId: Record<string, { id: string; status: string; checkInTime: Date }> = {};
    if (vehicleIds.length > 0) {
      const activeRows = await db
        .select({
          id: vehicleCheckIns.id,
          vehicleId: vehicleCheckIns.vehicleId,
          status: vehicleCheckIns.status,
          checkInTime: vehicleCheckIns.checkInTime,
        })
        .from(vehicleCheckIns)
        .where(
          and(
            inArray(vehicleCheckIns.vehicleId, vehicleIds),
            eq(vehicleCheckIns.isActive, true),
          ),
        );
      activeByVehicleId = activeRows.reduce<typeof activeByVehicleId>((acc, r) => {
        acc[r.vehicleId] = { id: r.id, status: r.status, checkInTime: r.checkInTime };
        return acc;
      }, {});
    }

    // Look up the most-recent BOOKED/CONFIRMED appointment per matched vehicle.
    // The gate-entry flow uses this to skip the external Evolve lookup and pull
    // vehicle details straight from the local DB when an appointment exists.
    let appointmentByVehicleId: Record<
      string,
      { id: string; serviceType: string; appointmentDate: string; appointmentTime: string }
    > = {};
    if (vehicleIds.length > 0) {
      const apptRows = await db
        .select({
          id: appointments.id,
          vehicleId: appointments.vehicleId,
          serviceType: appointments.serviceType,
          appointmentDate: appointments.appointmentDate,
          appointmentTime: appointments.appointmentTime,
        })
        .from(appointments)
        .where(
          and(
            inArray(appointments.vehicleId, vehicleIds),
            inArray(appointments.status, ['BOOKED', 'CONFIRMED']),
            isNull(appointments.deletedAt),
          ),
        )
        .orderBy(desc(appointments.createdAt));
      // First row per vehicle wins (rows are newest-first).
      appointmentByVehicleId = apptRows.reduce<typeof appointmentByVehicleId>((acc, r) => {
        if (r.vehicleId && !acc[r.vehicleId]) {
          acc[r.vehicleId] = {
            id: r.id,
            serviceType: r.serviceType,
            appointmentDate: r.appointmentDate,
            appointmentTime: r.appointmentTime,
          };
        }
        return acc;
      }, {});
    }

    // Once a vehicle reaches one of these statuses, its prior visit is
    // effectively complete (the customer has approved or billing is the only
    // step left) — a new gate entry should be allowed. Hide activeCheckIn for
    // these statuses so the frontend lets the user proceed.
    const ALLOW_REENTRY_STATUSES = new Set([
      'Job Card (Full Cust. Approval)',
      'In Service',
      'Ready for Billing',
    ]);

    const data = await Promise.all(
      rows.map(async (v: any) => {
        const imageUrl = (v as any).primaryImageKey ? await signUrl((v as any).primaryImageKey) : null;
        const active = activeByVehicleId[v.id] ?? null;
        const expose = active && !ALLOW_REENTRY_STATUSES.has(v.status);

        // Workshop guard surfaced to the FE so it can show a "Vehicle in
        // Workshop" message and disable the re-entry flow without waiting
        // for the 409 from the re-entry endpoint.
        const block = await getInWorkshopBlock(v.id);

        return {
          ...v,
          primaryImageUrl: imageUrl,
          activeCheckIn: expose
            ? {
                id: active!.id,
                status: active!.status,
                checkInTime: active!.checkInTime,
              }
            : null,
          inWorkshop: !!block,
          pendingJobItems: block?.pendingItems ?? 0,
          hasActiveAppointment: !!appointmentByVehicleId[v.id],
          activeAppointment: appointmentByVehicleId[v.id] ?? null,
        };
      }),
    );

    return success('Vehicles fetched successfully', data);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Vehicle Details ──────────────────────────────────────────────────────
export async function getVehicleDetails(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Fetch customer info
    let customer = null;
    if (vehicle.customerId) {
      const [cust] = await db
        .select({
          id: customers.id,
          crmReferenceNo: customers.crmReferenceNo,
          custSequenceId: customers.custSequenceId,
          customerType: customers.customerType,
          firstName: customers.firstName,
          lastName: customers.lastName,
          companyName: customers.companyName,
          primaryEmail: customers.primaryEmail,
        })
        .from(customers)
        .where(eq(customers.id, vehicle.customerId))
        .limit(1);

      if (cust) {
        const contacts = await db
          .select({
            contactType: customerContacts.contactType,
            countryCode: customerContacts.countryCode,
            contactNumber: customerContacts.contactNumber,
          })
          .from(customerContacts)
          .where(eq(customerContacts.customerId, cust.id));

        const primaryContact = contacts.find((c) => c.contactType === 'MOBILE') ?? contacts[0] ?? null;

        customer = {
          ...cust,
          fullName: [cust.firstName, cust.lastName].filter(Boolean).join(' ').trim(),
          contactNumber: primaryContact?.contactNumber ?? null,
          contacts,
        };
      }
    }

    // Fetch images
    const rawImages = await db
      .select({
        id: vehicleImages.id,
        vehicleId: vehicleImages.vehicleId,
        imageCategory: vehicleImages.imageCategory,
        imagePath: vehicleImages.imagePath,
        createdAt: vehicleImages.createdAt,
      })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, id));

    const images = await Promise.all(
      rawImages.map(async (img) => ({ ...img, imagePath: await signUrl(img.imagePath) })),
    );

    // Phase 1 — load the active check-in's per-visit fields (receiving no,
    // driver, fuel, damages, complaint, RO status) so the gate-entry edit
    // form can pre-fill them. Returns null if there's no active check-in.
    const [activeCheckIn] = await db
      .select({
        id: vehicleCheckIns.id,
        receivingNo: vehicleCheckIns.receivingNo,
        driverName: vehicleCheckIns.driverName,
        driverPhone: vehicleCheckIns.driverPhone,
        driverLicenceNo: vehicleCheckIns.driverLicenceNo,
        fuelLevel: vehicleCheckIns.fuelLevel,
        damagesNotes: vehicleCheckIns.damagesNotes,
        complaintText: vehicleCheckIns.complaintText,
        // Needed so the confirm modal can pre-select Route to Shop on edit.
        shop: vehicleCheckIns.shop,
        roStatus: vehicleCheckIns.roStatus,
        odometerReading: vehicleCheckIns.odometerReading,
        checkInTime: vehicleCheckIns.checkInTime,
      })
      .from(vehicleCheckIns)
      .where(and(eq(vehicleCheckIns.vehicleId, id), eq(vehicleCheckIns.isActive, true)))
      .orderBy(desc(vehicleCheckIns.checkInTime))
      .limit(1);

    // Customer complaint captured on the open booking, so the gate-entry form
    // can pre-fill the field. Mirrors the on-submit auto-fill in
    // confirm-entry/service.ts so the shown value matches what gets persisted.
    const [openAppt] = await db
      .select({ complaints: appointments.complaints })
      .from(appointments)
      .where(
        and(
          eq(appointments.vehicleId, id),
          inArray(appointments.status, ['BOOKED', 'CONFIRMED']),
        ),
      )
      .limit(1);
    const apptComplaints = openAppt?.complaints as string[] | null | undefined;
    const appointmentComplaint = apptComplaints && apptComplaints.length > 0 ? apptComplaints.join('; ') : null;

    return success('Vehicle details fetched successfully', {
      vehicle,
      customer,
      images,
      imageCount: images.length,
      activeCheckIn: activeCheckIn ?? null,
      appointmentComplaint,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── List Vehicles (Paginated, with visit UNION + stats) ─────────────────────
export async function listVehicles(request: FastifyRequest) {
  try {
    const query = vehicleListQuerySchema.parse(request.query ?? {});
    const { page, limit, status, filter, dateFrom, dateTo, vin, customerId, sortOrder, includeAll } = query;
    const offset = (page - 1) * limit;

    const INSIDE_STATUSES = [
      'Entry (Draft)', 'Vehicle IN', 'Inspection (Draft)', 'Inspection Done',
      'Job Card (Draft)', 'Job Card (Pending Parts Approval)', 'Job Card (Parts Approval Done)',
      'Job Card (Pending Cust. Approval)', 'Job Card (Partial Cust. Approval)',
      'Job Card (Full Cust. Approval)', 'In Service', 'Ready for Billing',
    ] as const;

    // ─── Build UNION query: one row per visit (current vehicle row + archived check-ins) ───
    // Archived check-ins are excluded when a status/filter is applied (status filters are
    // vehicle-status strings that don't apply to archived check-ins by design).
    // Vehicle 360 (includeAll=true) = one row per vehicle. Gate entry = one row per visit (union w/ archived check-ins).
    const includeArchived = !includeAll && !status && !filter;

    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00.000`).toISOString() : null;
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : null;

    // Current-visit filters (mirrors existing logic, expressed as raw SQL against alias `v`)
    const currentFilters: any[] = [];
    if (!includeAll) {
      currentFilters.push(sql`NOT EXISTS (SELECT 1 FROM appointments a WHERE a.vehicle_id = v.id AND a.deleted_at IS NULL AND a.status IN ('BOOKED','CONFIRMED'))`);
    }
    // Phantom filter — hide vehicles that never came through the gate (e.g.
    // fleet vehicles auto-imported from Evolve). A real gate entry has
    // entry_time set OR a check-in row. We SKIP this filter when the caller
    // explicitly scopes to a single customer (vehicle picker shows the full
    // owned fleet even if some haven't visited yet).
    if (!customerId) {
      currentFilters.push(sql`(
        v.entry_time IS NOT NULL
        OR EXISTS (SELECT 1 FROM vehicle_check_ins ci WHERE ci.vehicle_id = v.id)
        OR EXISTS (SELECT 1 FROM appointments a WHERE a.vehicle_id = v.id AND a.deleted_at IS NULL AND a.status IN ('BOOKED','CONFIRMED'))
      )`);
    }
    // PENDING / COMPLETED are the current UI tabs; INSIDE / PENDING_EXIT are the
    // previous names for the same two sets, still accepted so an older client or
    // a bookmarked URL keeps working.
    if (filter === 'PENDING' || filter === 'INSIDE') {
      // Still in the workshop — work not finished.
      currentFilters.push(sql`v.status IN (${sql.join(INSIDE_STATUSES.map((s) => sql`${s}`), sql`, `)})`);
    } else if (filter === 'COMPLETED' || filter === 'PENDING_EXIT') {
      // Work finished — awaiting (or past) gate release.
      currentFilters.push(sql`v.status = 'Completed'`);
    } else if (status) {
      currentFilters.push(sql`v.status = ${status}`);
    }
    if (fromDate || toDate) {
      currentFilters.push(sql`(
        (${fromDate ? sql`v.entry_time >= ${fromDate}::timestamptz` : sql`TRUE`} AND ${toDate ? sql`v.entry_time <= ${toDate}::timestamptz` : sql`TRUE`})
        OR (${fromDate ? sql`v.updated_at >= ${fromDate}::timestamptz` : sql`TRUE`} AND ${toDate ? sql`v.updated_at <= ${toDate}::timestamptz` : sql`TRUE`})
      )`);
    }
    if (vin) {
      currentFilters.push(sql`(v.vin ILIKE ${'%' + vin + '%'} OR v.registration_number ILIKE ${'%' + vin + '%'})`);
    }
    if (customerId) {
      currentFilters.push(sql`v.customer_id = ${customerId}`);
    }
    const currentWhere = currentFilters.length > 0 ? sql`WHERE ${sql.join(currentFilters, sql` AND `)}` : sql``;

    // Archived-visit filters (against `vci` + joined `v`).
    // An archived check-in only represents a *previous* visit if there is a
    // newer check-in for the same vehicle. Otherwise the current vehicles
    // row already represents that visit and showing the archived row would
    // duplicate it (e.g. when a check-in is just closed by customer approval
    // but no new visit has started yet).
    const archivedFilters: any[] = [
      sql`vci.is_active = false`,
      sql`(
        EXISTS (
          SELECT 1 FROM vehicle_check_ins vci2
          WHERE vci2.vehicle_id = vci.vehicle_id
            AND vci2.check_in_time > vci.check_in_time
        )
        OR EXISTS (
          SELECT 1 FROM vehicles v3
          WHERE v3.id = vci.vehicle_id
            AND v3.status = 'Entry (Draft)'
            AND v3.entry_time IS NULL
        )
      )`,
    ];
    if (fromDate) archivedFilters.push(sql`vci.check_in_time >= ${fromDate}::timestamptz`);
    if (toDate) archivedFilters.push(sql`vci.check_in_time <= ${toDate}::timestamptz`);
    if (vin) archivedFilters.push(sql`(v.vin ILIKE ${'%' + vin + '%'} OR v.registration_number ILIKE ${'%' + vin + '%'})`);
    if (customerId) archivedFilters.push(sql`v.customer_id = ${customerId}`);
    const archivedWhere = sql`WHERE ${sql.join(archivedFilters, sql` AND `)}`;

    // Sort by visit_time, falling back to updated_at so newly added vehicles
    // (which have no entry_time yet) still appear at the top when sortOrder=desc.
    const dir = sortOrder === 'asc' ? sql`ASC` : sql`DESC`;
    const orderByClause = vin
      ? sql`ORDER BY CASE WHEN vin ILIKE ${'%' + vin + '%'} THEN 0 ELSE 1 END, COALESCE(visit_time, updated_at) ${dir}`
      : sql`ORDER BY COALESCE(visit_time, updated_at) ${dir}`;

    const currentSelect = sql`
      SELECT
        v.id::text AS id,
        v.id::text AS vehicle_id,
        NULL::text AS check_in_id,
        'current' AS visit_type,
        v.vin, v.registration_number, v.brand, v.model, v.model_variant,
        v.fuel_type, v.transmission_type,
        v.manufacturing_year, v.odometer_last, v.priority,
        v.status AS status,
        (SELECT vci.ro_status FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS ro_status,
        (SELECT vci.receiving_no FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS receiving_no,
        (SELECT vci.driver_name FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS driver_name,
        (SELECT vci.driver_phone FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS driver_phone,
        (SELECT vci.driver_licence_no FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS driver_licence_no,
        (SELECT vci.fuel_level FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS fuel_level,
        (SELECT vci.damages_notes FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS damages_notes,
        (SELECT vci.complaint_text FROM vehicle_check_ins vci WHERE vci.vehicle_id = v.id AND vci.is_active = true ORDER BY vci.check_in_time DESC LIMIT 1) AS complaint_text,
        (SELECT wb.bay_no FROM workshop_allocations wa
          INNER JOIN vehicle_check_ins vci ON vci.id = wa.check_in_id
          INNER JOIN workshop_bays wb ON wb.id = wa.bay_id
          WHERE vci.vehicle_id = v.id AND vci.is_active = true AND wa.released_at IS NULL
          LIMIT 1) AS bay_no,
        (SELECT wa.priority::text FROM workshop_allocations wa
          INNER JOIN vehicle_check_ins vci ON vci.id = wa.check_in_id
          WHERE vci.vehicle_id = v.id AND vci.is_active = true AND wa.released_at IS NULL
          LIMIT 1) AS allocation_priority,
        (SELECT wa.repair_category::text FROM workshop_allocations wa
          INNER JOIN vehicle_check_ins vci ON vci.id = wa.check_in_id
          WHERE vci.vehicle_id = v.id AND vci.is_active = true AND wa.released_at IS NULL
          LIMIT 1) AS repair_category,
        v.entry_time AS visit_time,
        v.entry_time, v.updated_at,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name,
        c.company_name AS customer_company_name,
        COALESCE(
          NULLIF((SELECT COUNT(*)::int FROM vehicle_images WHERE vehicle_id = v.id), 0),
          (SELECT COUNT(*)::int FROM vehicle_check_in_photos p
             WHERE p.vehicle_check_in_id = (SELECT vci2.id FROM vehicle_check_ins vci2 WHERE vci2.vehicle_id = v.id ORDER BY vci2.check_in_time DESC LIMIT 1))
        ) AS image_count,
        COALESCE(
          (SELECT image_path FROM vehicle_images WHERE vehicle_id = v.id AND image_category = 'Front View' LIMIT 1),
          (SELECT p.image_url FROM vehicle_check_in_photos p
             WHERE p.vehicle_check_in_id = (SELECT vci2.id FROM vehicle_check_ins vci2 WHERE vci2.vehicle_id = v.id ORDER BY vci2.check_in_time DESC LIMIT 1)
               AND p.photo_type = 'FRONT' LIMIT 1)
        ) AS front_image,
        (SELECT qi.id FROM qc_inspections qi INNER JOIN vehicle_check_ins vci ON vci.id = qi.vehicle_check_in_id WHERE vci.vehicle_id = v.id AND qi.status != 'COMPLETED' ORDER BY qi.created_at DESC LIMIT 1) AS inspection_id
      FROM vehicles v
      LEFT JOIN customers c ON c.id = v.customer_id
      ${currentWhere}
    `;

    const archivedSelect = sql`
      SELECT
        vci.id::text AS id,
        v.id::text AS vehicle_id,
        vci.id::text AS check_in_id,
        'archived' AS visit_type,
        v.vin, v.registration_number, v.brand, v.model, v.model_variant,
        v.fuel_type, v.transmission_type,
        v.manufacturing_year, vci.odometer_reading AS odometer_last, v.priority,
        CASE vci.status
          WHEN 'COMPLETED' THEN 'Completed'
          WHEN 'READY' THEN 'Ready for Billing'
          WHEN 'IN_SERVICE' THEN 'In Service'
          WHEN 'IN_QUEUE' THEN 'Vehicle IN'
          WHEN 'CANCELLED' THEN 'Cancelled'
          ELSE vci.status::text
        END AS status,
        vci.ro_status AS ro_status,
        vci.receiving_no AS receiving_no,
        vci.driver_name AS driver_name,
        vci.driver_phone AS driver_phone,
        vci.driver_licence_no AS driver_licence_no,
        vci.fuel_level AS fuel_level,
        vci.damages_notes AS damages_notes,
        vci.complaint_text AS complaint_text,
        NULL::text AS bay_no,
        NULL::text AS allocation_priority,
        NULL::text AS repair_category,
        vci.check_in_time AS visit_time,
        vci.check_in_time AS entry_time,
        vci.updated_at,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name,
        c.company_name AS customer_company_name,
        (SELECT COUNT(*)::int FROM vehicle_check_in_photos WHERE vehicle_check_in_id = vci.id) AS image_count,
        (SELECT image_url FROM vehicle_check_in_photos WHERE vehicle_check_in_id = vci.id AND photo_type = 'FRONT' LIMIT 1) AS front_image,
        NULL::uuid AS inspection_id
      FROM vehicle_check_ins vci
      INNER JOIN vehicles v ON v.id = vci.vehicle_id
      LEFT JOIN customers c ON c.id = v.customer_id
      ${archivedWhere}
    `;

    const unionSql = includeArchived
      ? sql`(${currentSelect}) UNION ALL (${archivedSelect})`
      : currentSelect;

    const totalResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM (${unionSql}) AS u`);
    const total: number = (totalResult.rows[0] as any)?.total ?? 0;

    const rowsResult = await db.execute(sql`
      SELECT * FROM (${unionSql}) AS u
      ${orderByClause}
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = rowsResult.rows as any[];

    // Stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);
    yesterdayEnd.setMilliseconds(-1);

    // Phantom-exclusion clause shared by all stat counts below.
    // "Real" vehicle = has entry_time OR check-in OR active appointment.
    const realEntryClause = sql`(
      ${vehicles.entryTime} IS NOT NULL
      OR EXISTS (SELECT 1 FROM vehicle_check_ins ci WHERE ci.vehicle_id = ${vehicles.id})
      OR EXISTS (SELECT 1 FROM appointments a WHERE a.vehicle_id = ${vehicles.id} AND a.deleted_at IS NULL AND a.status IN ('BOOKED','CONFIRMED'))
    )`;

    // Vehicles entered or updated today
    const [enteredTodayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.isActive, true),
          or(
            and(gte(vehicles.entryTime, todayStart), lte(vehicles.entryTime, todayEnd)),
            and(gte(vehicles.updatedAt, todayStart), lte(vehicles.updatedAt, todayEnd)),
          ),
          realEntryClause,
        ),
      );

    // Vehicles entered or updated yesterday
    const [enteredYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.isActive, true),
          or(
            and(gte(vehicles.entryTime, yesterdayStart), lte(vehicles.entryTime, yesterdayEnd)),
            and(gte(vehicles.updatedAt, yesterdayStart), lte(vehicles.updatedAt, yesterdayEnd)),
          ),
          realEntryClause,
        ),
      );

    // Currently inside (not completed or cancelled)
    const [currentlyInsideCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, [...INSIDE_STATUSES]),
          eq(vehicles.isActive, true),
          realEntryClause,
        ),
      );

    // Currently inside yesterday (vehicles that entered yesterday and are still not completed)
    const [insideYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, [...INSIDE_STATUSES]),
          gte(vehicles.entryTime, yesterdayStart),
          lte(vehicles.entryTime, yesterdayEnd),
          eq(vehicles.isActive, true),
        ),
      );

    const [pendingCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, ['Entry (Draft)', 'Vehicle IN']),
          eq(vehicles.isActive, true),
          realEntryClause,
        ),
      );

    const [inProgressCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Inspection (Draft)'),
          eq(vehicles.isActive, true),
          realEntryClause,
        ),
      );

    const [completedCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'Inspection Done'),
          eq(vehicles.isActive, true),
          realEntryClause,
        ),
      );

    // Pending exit yesterday
    const [pendingYesterdayCount] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(
        and(
          inArray(vehicles.status, ['Entry (Draft)', 'Vehicle IN']),
          gte(vehicles.entryTime, yesterdayStart),
          lte(vehicles.entryTime, yesterdayEnd),
          eq(vehicles.isActive, true),
          realEntryClause,
        ),
      );

    // Avg time inside today
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
          sql`${qcInspections.completedAt} >= ${todayStart.toISOString()}`,
        ),
      );

    // Avg time inside yesterday
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
          sql`${qcInspections.completedAt} >= ${yesterdayStart.toISOString()}`,
          sql`${qcInspections.completedAt} < ${todayStart.toISOString()}`,
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

    const data = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        vehicleId: row.vehicle_id,
        checkInId: row.check_in_id,
        visitType: row.visit_type,
        vin: row.vin,
        registrationNumber: row.registration_number,
        brand: row.brand,
        model: row.model,
        modelVariant: row.model_variant,
        fuelType: row.fuel_type ?? null,
        transmissionType: row.transmission_type ?? null,
        manufacturingYear: row.manufacturing_year,
        odometerLast: row.odometer_last,
        priority: row.priority ?? 'STANDARD',
        status: row.status,
        entryTime: row.entry_time,
        updatedAt: row.updated_at,
        customerName:
          (row.customer_company_name?.trim() ||
            `${row.customer_first_name ?? ''} ${row.customer_last_name ?? ''}`.trim()) || null,
        imageCount: row.image_count,
        frontImage: await signUrl(row.front_image),
        inspectionId: row.inspection_id,
        roStatus: row.ro_status ?? null,
        receivingNo: row.receiving_no ?? null,
        driverName: row.driver_name ?? null,
        driverPhone: row.driver_phone ?? null,
        driverLicenceNo: row.driver_licence_no ?? null,
        fuelLevel: row.fuel_level ?? null,
        damagesNotes: row.damages_notes ?? null,
        complaintText: row.complaint_text ?? null,
        bayNo: row.bay_no ?? null,
        allocationPriority: row.allocation_priority ?? null,
        repairCategory: row.repair_category ?? null,
      })),
    );

    return success('Vehicles fetched successfully', {
      data,
      stats: {
        vehiclesEnteredToday: enteredTodayCount.total,
        vehiclesEnteredYesterday: enteredYesterdayCount.total,
        currentlyInside: currentlyInsideCount.total,
        currentlyInsideYesterday: insideYesterdayCount.total,
        pendingInspection: pendingCount.total,
        pendingExitYesterday: pendingYesterdayCount.total,
        inProgress: inProgressCount.total,
        completed: completedCount.total,
        avgTimeInside,
        avgTimeInsideYesterday,
      },
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

// ─── Update Vehicle ───────────────────────────────────────────────────────────
export async function updateVehicle(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Explicitly exclude immutable fields — entryTime and createdAt must never change after creation
    const { entryTime: _et, createdAt: _ca, createdBy: _cb, ...safeBody } = body as any;

    // Block updates that would collide with another active (non-archived) vehicle's VIN or registrationNumber.
    if (safeBody.vin) {
      const [conflict] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.vin, safeBody.vin),
            ne(vehicles.id, id),
            ne(vehicles.status, 'Archived'),
          ),
        )
        .limit(1);
      if (conflict) {
        return error(HttpStatus.CONFLICT, 'VIN already registered to another vehicle');
      }
    }
    if (safeBody.registrationNumber) {
      const [conflict] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.registrationNumber, safeBody.registrationNumber),
            ne(vehicles.id, id),
            ne(vehicles.status, 'Archived'),
          ),
        )
        .limit(1);
      if (conflict) {
        return error(HttpStatus.CONFLICT, 'Registration number already registered to another vehicle');
      }
    }

    const actorId = await resolveActorId(request);
    const [updated] = await db
      .update(vehicles)
      .set({ ...safeBody, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(vehicles.id, id))
      .returning();

    return success('Vehicle updated successfully', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Vehicle (Soft — Cancel Entry) ────────────────────────────────────
export async function deleteVehicle(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Soft-delete: cancel the entry without destroying the vehicle record or images
    const now = new Date();
    await db
      .update(vehicles)
      .set({
        status:    'Cancelled',
        isActive:  false,
        deletedAt: now,
      })
      .where(eq(vehicles.id, id));

    // Also mark the active check-in as CANCELLED so the visit timeline reflects it
    const actorId = await resolveActorId(request);
    await db
      .update(vehicleCheckIns)
      .set({
        status:      'CANCELLED',
        completedAt: now,
        isActive:    false,
        updatedAt:   now,
        updatedBy:   actorId,
      })
      .where(and(eq(vehicleCheckIns.vehicleId, id), eq(vehicleCheckIns.isActive, true)));

    return success('Vehicle entry cancelled successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Hard Delete Vehicle ──────────────────────────────────────────────────────
export async function hardDeleteVehicle(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    if ((vehicle as any).primaryImageKey) {
      await deleteFile((vehicle as any).primaryImageKey);
    }

    await db.delete(vehicles).where(eq(vehicles.id, id));

    return success('Vehicle permanently deleted', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Maps vehicle status string to vehicleCheckInStatusEnum
function toCheckInStatus(
  status: string,
): 'IN_QUEUE' | 'IN_SERVICE' | 'READY' | 'COMPLETED' | 'CANCELLED' {
  if (status === 'Completed') return 'COMPLETED';
  if (status === 'Cancelled') return 'CANCELLED';
  if (status === 'Ready for Billing') return 'READY';
  if (
    status === 'Inspection (Draft)' ||
    status === 'Inspection Done' ||
    status === 'Job Card (Draft)' ||
    status === 'Job Card (Pending Cust. Approval)' ||
    status === 'Job Card (Partial Cust. Approval)' ||
    status === 'Job Card (Full Cust. Approval)' ||
    status === 'In Service'
  )
    return 'IN_SERVICE';
  return 'IN_QUEUE';
}

// Maps imageCategory varchar to vehiclePhotoTypeEnum
function toPhotoType(
  category: string | null,
): 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'DASHBOARD' | 'ENGINE' | 'OTHER' {
  const cat = (category ?? '').toLowerCase();
  if (cat.includes('front')) return 'FRONT';
  if (cat.includes('rear') || cat.includes('back')) return 'REAR';
  if (cat.includes('left')) return 'LEFT';
  if (cat.includes('right')) return 'RIGHT';
  if (cat.includes('dashboard') || cat.includes('dash')) return 'DASHBOARD';
  if (cat.includes('engine')) return 'ENGINE';
  return 'OTHER';
}

// ─── In-Workshop Guard ──────────────────────────────────────────────────────
// A vehicle is "in workshop" while its active check-in has any job_card_items
// that aren't completed yet. Returns a summary so callers can surface a clear
// "vehicle is still being worked on" message, or null if the vehicle is free
// for a new entry. Note: a vehicle whose active check-in exists but has NO
// job cards yet is not blocked — the gate keeper is allowed to cancel/edit
// such an entry.
async function getInWorkshopBlock(vehicleId: string): Promise<
  | null
  | { pendingItems: number; vehicleStatus: string }
> {
  const [activeCheckIn] = await db
    .select({ id: vehicleCheckIns.id })
    .from(vehicleCheckIns)
    .where(and(eq(vehicleCheckIns.vehicleId, vehicleId), eq(vehicleCheckIns.isActive, true)))
    .limit(1);
  if (!activeCheckIn) return null;

  // Items linked to job cards belonging to the active check-in that aren't
  // marked complete. Includes items with no assigned technician — work that
  // a SA created but the technician hasn't finished is still "in workshop".
  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(jobCardItems)
    .innerJoin(jobCards, eq(jobCards.id, jobCardItems.jobCardId))
    .where(
      and(
        eq(jobCards.vehicleCheckInId, activeCheckIn.id),
        sql`${jobCardItems.completedAt} IS NULL`,
      ),
    );

  if (Number(remaining) === 0) return null;

  const [veh] = await db
    .select({ status: vehicles.status })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);

  return {
    pendingItems: Number(remaining),
    vehicleStatus: veh?.status ?? 'In Service',
  };
}

// ─── Active-Entry Guard ──────────────────────────────────────────────────────
// A vehicle has an *active gate entry* while it still has an isActive check-in
// whose vehicle status is one of the "inside the workshop" stages (Vehicle IN,
// Entry (Draft), inspection, job-card stages before customer approval). A new
// gate entry must be refused until that visit completes — i.e. the vehicle has
// reached a re-entry-eligible status or has left through the gate. Returns the
// blocking check-in summary, or null when a new entry is allowed.
//
// This is broader than getInWorkshopBlock (which only looks at pending job
// items): a freshly-arrived vehicle has no job cards yet but is still inside,
// and must not get a second active entry.
async function getActiveEntryBlock(vehicleId: string): Promise<
  | null
  | { checkInId: string; status: string; checkInTime: Date; vehicleStatus: string }
> {
  const ALLOW_REENTRY_STATUSES = new Set([
    'Job Card (Full Cust. Approval)',
    'In Service',
    'Ready for Billing',
  ]);

  const [active] = await db
    .select({
      id: vehicleCheckIns.id,
      status: vehicleCheckIns.status,
      checkInTime: vehicleCheckIns.checkInTime,
    })
    .from(vehicleCheckIns)
    .where(and(eq(vehicleCheckIns.vehicleId, vehicleId), eq(vehicleCheckIns.isActive, true)))
    .limit(1);
  if (!active) return null;

  const [veh] = await db
    .select({ status: vehicles.status })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);

  // Prior visit effectively complete (customer-approved / in service / ready
  // for billing) → re-entry is allowed; the caller archives the old check-in.
  if (ALLOW_REENTRY_STATUSES.has(veh?.status as string)) return null;

  return {
    checkInId: active.id,
    status: active.status,
    checkInTime: active.checkInTime,
    vehicleStatus: veh?.status ?? 'Vehicle IN',
  };
}

// ─── Re-Entry Vehicle ─────────────────────────────────────────────────────────
// Archives the previous check-in (with its photos, inspections, job cards) and
// resets the same vehicle row to 'Entry (Draft)' so the next gate-entry flow
// creates a brand-new check-in against it.
export async function reEntryVehicle(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Refuse a new gate entry while the vehicle still has an active visit that
    // hasn't completed the gate-exit process. Without this, re-entry would
    // archive the live check-in and let a second "Vehicle IN" entry be created
    // for a vehicle that never left — a duplicate active gate entry. This is
    // the authoritative check that backs the frontend guard and cannot be
    // bypassed via direct API calls (e.g. the vinLookup local-fallback path).
    const activeEntry = await getActiveEntryBlock(id);
    if (activeEntry) {
      const enteredAt = new Date(activeEntry.checkInTime).toLocaleString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
        hour12: true,
      });
      return error(
        HttpStatus.CONFLICT,
        `This vehicle is already inside the workshop (entered ${enteredAt}). Please complete the Gate Exit process before creating a new Gate Entry.`,
      );
    }

    // Block re-entry while a technician still has unfinished work on the
    // current visit. The gate keeper / service advisor needs to wait until
    // every assigned job item is marked complete before starting a new
    // visit for this vehicle.
    const block = await getInWorkshopBlock(id);
    if (block) {
      return error(
        HttpStatus.CONFLICT,
        `Vehicle is still in the workshop (status: ${block.vehicleStatus}). ${block.pendingItems} job item${block.pendingItems === 1 ? '' : 's'} pending — wait for the technician to finish before creating a new entry.`,
      );
    }

    // Resolve actor up-front so we can attribute the close + any new check-in.
    const actorId = await resolveActorId(request);

    // Fetch existing images before wiping
    const existingImages = await db
      .select()
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, id));

    // Find the active check-in for this vehicle (created by QC or gate entry).
    const [existingCheckIn] = await db
      .select({ id: vehicleCheckIns.id })
      .from(vehicleCheckIns)
      .where(and(eq(vehicleCheckIns.vehicleId, id), eq(vehicleCheckIns.isActive, true)))
      .limit(1);

    let archiveCheckInId: string | null = null;

    if (existingCheckIn) {
      // Close out the current check-in — job cards & inspections stay linked
      await db
        .update(vehicleCheckIns)
        .set({
          isActive: false,
          status: toCheckInStatus(vehicle.status),
          completedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(eq(vehicleCheckIns.id, existingCheckIn.id));
      archiveCheckInId = existingCheckIn.id;

      // Phase 2: if the vehicle was sitting in a workshop bay, free it up.
      // The new visit will get its own allocation when it reaches QC.
      try {
        const mod = await import('../workshop/service');
        await mod.releaseAllocationForCheckIn(existingCheckIn.id);
      } catch (e) {
        console.error('[reEntryVehicle] bay release failed:', e);
      }
    } else {
      // No active check-in. The previous visit's check-in may have already
      // been closed (e.g. by customer-approval flow). Reuse the most recent
      // closed check-in for photo linking instead of creating a duplicate.
      const [recentClosed] = await db
        .select({ id: vehicleCheckIns.id })
        .from(vehicleCheckIns)
        .where(eq(vehicleCheckIns.vehicleId, id))
        .orderBy(desc(vehicleCheckIns.checkInTime))
        .limit(1);

      if (recentClosed) {
        archiveCheckInId = recentClosed.id;
      } else if (existingImages.length > 0) {
        // Truly no check-in at all (legacy/edge case) — snapshot photos
        // under a fresh closed check-in so they aren't lost.
        const [newCheckIn] = await db
          .insert(vehicleCheckIns)
          .values({
            vehicleId: id,
            odometerReading: vehicle.odometerLast,
            status: toCheckInStatus(vehicle.status),
            checkInTime: vehicle.entryTime ?? new Date(),
            completedAt: new Date(),
            isActive: false,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
        archiveCheckInId = newCheckIn.id;
      }
    }

    // Copy image URLs into vehicle_check_in_photos (storage files are kept)
    if (existingImages.length > 0 && archiveCheckInId) {
      await db.insert(vehicleCheckInPhotos).values(
        existingImages.map((img) => ({
          vehicleCheckInId: archiveCheckInId!,
          photoType: toPhotoType(img.imageCategory),
          imageUrl: img.imagePath,
        })),
      );
    }

    // Link any unlinked appointment for this vehicle to the archived check-in
    if (archiveCheckInId) {
      await db
        .update(appointments)
        .set({ checkInId: archiveCheckInId, updatedAt: new Date() })
        .where(
          and(
            eq(appointments.vehicleId, id),
            eq(appointments.checkInId, null as any),
          ),
        );
    }

    // Remove active image records — files are now owned by the archived check-in
    await db.delete(vehicleImages).where(eq(vehicleImages.vehicleId, id));

    // Reset the same vehicle row for the new visit. Clear deletedAt too —
    // re-entry after Cancel Entry needs to revive the soft-deleted row,
    // otherwise downstream isNull(deletedAt) filters keep excluding it.
    const [updated] = await db
      .update(vehicles)
      .set({
        status: 'Entry (Draft)',
        entryTime: null,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(eq(vehicles.id, id))
      .returning();

    return success('Vehicle reset for re-entry. Previous visit archived.', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Vehicle Visit History ────────────────────────────────────────────────
// Returns all past visits for a vehicle with photos, inspection, job card, appointment.
export async function getVehicleVisitHistory(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [vehicle] = await db
      .select({
        id: vehicles.id,
        status: vehicles.status,
        entryTime: vehicles.entryTime,
        createdBy: vehicles.createdBy,
        updatedBy: vehicles.updatedBy,
        createdAt: vehicles.createdAt,
        customerId: vehicles.customerId,
        registrationNumber: vehicles.registrationNumber,
        vin: vehicles.vin,
      })
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    // Resolve customer name for JOB_CARD_APPROVED attribution
    let customerName: string | null = null;
    if (vehicle.customerId) {
      const [cust] = await db
        .select({ firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName })
        .from(customers)
        .where(eq(customers.id, vehicle.customerId))
        .limit(1);
      if (cust) {
        const personal = `${cust.firstName ?? ''} ${cust.lastName ?? ''}`.trim();
        customerName = personal || cust.companyName || null;
      }
    }

    // The same physical vehicle can end up with SEVERAL `vehicles` rows — a
    // re-entry that didn't match an existing record creates a new one (often
    // with a NO-VIN- placeholder). Scoping the history to a single row then
    // shows only the visits recorded against that row, so a returning vehicle
    // looks like it has never been here before.
    //
    // Link siblings on the registration number (case/space-insensitive), plus
    // VIN when it is a real one — placeholder VINs differ per row so they never
    // match. Registration is the only key that survives a re-entry.
    const reg = (vehicle.registrationNumber ?? '').trim().toUpperCase();
    const realVin = vehicle.vin && !/^NO-VIN-/i.test(vehicle.vin) ? vehicle.vin.trim() : null;
    const siblingRows = (reg || realVin)
      ? await db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(
            or(
              ...(reg ? [sql`UPPER(TRIM(${vehicles.registrationNumber})) = ${reg}`] : []),
              ...(realVin ? [eq(vehicles.vin, realVin)] : []),
            ),
          )
      : [];
    const vehicleIds = [...new Set([id, ...siblingRows.map((r) => r.id)])];

    // Fetch ALL check-ins across those rows (active and archived), newest first
    const checkIns = await db
      .select()
      .from(vehicleCheckIns)
      .where(inArray(vehicleCheckIns.vehicleId, vehicleIds))
      .orderBy(desc(vehicleCheckIns.checkInTime));

    if (checkIns.length === 0) {
      return success('Visit history fetched successfully', []);
    }

    const checkInIds = checkIns.map((c) => c.id);

    // The latest check-in is the "current" visit while the vehicle is still
    // physically inside the workshop (status in any pre-exit state). Once the
    // vehicle exits (Completed / Cancelled / Archived), no row is current
    // — even though the customer-approval flow closes the check-in row at
    // job-card approval, the vehicle itself can still be in 'In Service' /
    // 'Ready for Billing' which we treat as still-current for display.
    const INSIDE_STATUSES = new Set([
      'Entry (Draft)', 'Vehicle IN', 'Inspection (Draft)', 'Inspection Done',
      'Job Card (Draft)', 'Job Card (Pending Parts Approval)', 'Job Card (Parts Approval Done)',
      'Job Card (Pending Cust. Approval)', 'Job Card (Partial Cust. Approval)',
      'Job Card (Full Cust. Approval)', 'In Service', 'Ready for Billing',
    ]);
    const isInsideWorkshop = INSIDE_STATUSES.has(vehicle.status as string);
    const latestCheckInId = checkIns[0].id;

    // Active check-in's photos still live in vehicle_images (not yet archived into vehicle_check_in_photos)
    const activeCheckIn = checkIns.find((c) => c.isActive);

    // Fetch all photos, inspections, job cards, appointments for these check-ins in bulk
    const [photos, activePhotos, inspections, cards, appts] = await Promise.all([
      db.select().from(vehicleCheckInPhotos).where(inArray(vehicleCheckInPhotos.vehicleCheckInId, checkInIds)),
      activeCheckIn
        ? db.select().from(vehicleImages).where(eq(vehicleImages.vehicleId, id))
        : Promise.resolve([] as any[]),
      db.select({
        id: qcInspections.id,
        vehicleCheckInId: qcInspections.vehicleCheckInId,
        overallStatus: qcInspections.overallStatus,
        finalRemarks: qcInspections.finalRemarks,
        status: qcInspections.status,
        startedAt: qcInspections.startedAt,
        completedAt: qcInspections.completedAt,
        createdBy: qcInspections.createdBy,
        completedBy: qcInspections.completedBy,
      }).from(qcInspections).where(inArray(qcInspections.vehicleCheckInId, checkInIds)),
      db.select({
        id: jobCards.id,
        vehicleCheckInId: jobCards.vehicleCheckInId,
        serviceType: jobCards.serviceType,
        serviceCategory: jobCards.serviceCategory,
        totalEstimate: jobCards.totalEstimate,
        status: jobCards.status,
        createdAt: jobCards.createdAt,
        sharedAt: jobCards.sharedAt,
        approvedAt: jobCards.approvedAt,
        createdBy: jobCards.createdBy,
        updatedBy: jobCards.updatedBy,
      }).from(jobCards).where(inArray(jobCards.vehicleCheckInId, checkInIds)),
      db.select({
        id: appointments.id,
        checkInId: appointments.checkInId,
        appointmentDate: appointments.appointmentDate,
        appointmentTime: appointments.appointmentTime,
        serviceType: appointments.serviceType,
        status: appointments.status,
      }).from(appointments).where(inArray(appointments.checkInId, checkInIds)),
    ]);

    // Group by checkInId
    const photosByCheckIn   = photos.reduce<Record<string, typeof photos>>((acc, p) => { (acc[p.vehicleCheckInId] ??= []).push(p); return acc; }, {});
    const inspByCheckIn     = inspections.reduce<Record<string, (typeof inspections)[0]>>((acc, i) => { acc[i.vehicleCheckInId] = i; return acc; }, {});
    const cardByCheckIn     = cards.reduce<Record<string, (typeof cards)[0]>>((acc, c) => { if (c.vehicleCheckInId) acc[c.vehicleCheckInId] = c; return acc; }, {});
    const apptByCheckIn     = appts.reduce<Record<string, (typeof appts)[0]>>((acc, a) => { if (a.checkInId) acc[a.checkInId] = a; return acc; }, {});

    // Gate passes — the EXIT side of each visit. Without these the timeline
    // recorded when a vehicle arrived but never when it left.
    const passes = await db
      .select({
        checkInId: gatePasses.checkInId,
        code: gatePasses.code,
        status: gatePasses.status,
        generatedAt: gatePasses.generatedAt,
        generatedBy: gatePasses.generatedBy,
        redeemedAt: gatePasses.redeemedAt,
        redeemedBy: gatePasses.redeemedBy,
        odometerOut: gatePasses.odometerOut,
        driverOutName: gatePasses.driverOutName,
      })
      .from(gatePasses)
      .where(inArray(gatePasses.checkInId, checkInIds));
    const passesByCheckIn = passes.reduce<Record<string, typeof passes>>((acc, g) => {
      if (g.checkInId) (acc[g.checkInId] ??= []).push(g);
      return acc;
    }, {});

    // Job card items + time logs for technician timeline events.
    const cardIds = cards.map((c) => c.id);
    const items = cardIds.length === 0 ? [] : await db
      .select({
        id: jobCardItems.id,
        jobCardId: jobCardItems.jobCardId,
        jobDescription: jobCardItems.jobDescription,
        assignedTechnicianId: jobCardItems.assignedTechnicianId,
        assignedAt: jobCardItems.assignedAt,
        assignedBy: jobCardItems.assignedBy,
        completedAt: jobCardItems.completedAt,
        completedBy: jobCardItems.completedBy,
      })
      .from(jobCardItems)
      .where(inArray(jobCardItems.jobCardId, cardIds));
    const itemIds = items.map((i) => i.id);
    const timeLogs = itemIds.length === 0 ? [] : await db
      .select({
        itemId: jobCardItemTimeLogs.jobCardItemId,
        technicianId: jobCardItemTimeLogs.technicianId,
        startedAt: jobCardItemTimeLogs.startedAt,
        pausedAt: jobCardItemTimeLogs.pausedAt,
      })
      .from(jobCardItemTimeLogs)
      .where(inArray(jobCardItemTimeLogs.jobCardItemId, itemIds));

    const itemsByCard = items.reduce<Record<string, typeof items>>((acc, it) => { (acc[it.jobCardId] ??= []).push(it); return acc; }, {});
    const logsByItem = timeLogs.reduce<Record<string, typeof timeLogs>>((acc, l) => { (acc[l.itemId] ??= []).push(l); return acc; }, {});

    // Resolve user names for all actors referenced in the timeline
    const userIds = new Set<string>();
    if (vehicle.createdBy) userIds.add(vehicle.createdBy);
    if (vehicle.updatedBy) userIds.add(vehicle.updatedBy);
    checkIns.forEach((c) => { if (c.createdBy) userIds.add(c.createdBy); if (c.updatedBy) userIds.add(c.updatedBy); });
    inspections.forEach((i) => { if (i.createdBy) userIds.add(i.createdBy); if (i.completedBy) userIds.add(i.completedBy); });
    cards.forEach((c) => { if (c.createdBy) userIds.add(c.createdBy); if (c.updatedBy) userIds.add(c.updatedBy); });
    items.forEach((it) => {
      if (it.assignedTechnicianId) userIds.add(it.assignedTechnicianId);
      if (it.assignedBy) userIds.add(it.assignedBy);
      if (it.completedBy) userIds.add(it.completedBy);
    });
    timeLogs.forEach((l) => { if (l.technicianId) userIds.add(l.technicianId); });

    const userRows = userIds.size > 0
      ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, [...userIds]))
      : [];
    const userNameById = new Map(userRows.map((u) => [u.id, u.username]));
    const nameOf = (uid: string | null | undefined) => (uid ? userNameById.get(uid) ?? null : null);

    const data = await Promise.all(checkIns.map(async (c) => {
      const insp = inspByCheckIn[c.id] ?? null;
      const card = cardByCheckIn[c.id] ?? null;

      // Build chronological timeline
      const events: Array<{ type: string; label: string; at: Date | string; byId: string | null; by: string | null }> = [];

      // Gate keeper attribution comes from the check-in row itself. Older
      // visits created before created_by/updated_by were captured will be null.
      const entryActorId = c.createdBy ?? (c.isActive ? (vehicle.updatedBy ?? vehicle.createdBy) : null);
      const confirmActorId = c.updatedBy ?? entryActorId;

      const entryAt = c.checkInTime ?? vehicle.entryTime;
      if (entryAt) {
        events.push({
          type: 'ENTRY',
          label: 'Vehicle entry recorded',
          at: entryAt,
          byId: entryActorId,
          by: nameOf(entryActorId),
        });
      }
      if (c.confirmedAt) {
        events.push({
          type: 'CHECK_IN_CONFIRMED',
          label: 'Check-in confirmed',
          at: c.confirmedAt,
          byId: confirmActorId,
          by: nameOf(confirmActorId),
        });
      }
      if (insp?.startedAt) {
        events.push({ type: 'QC_STARTED', label: 'QC inspection started', at: insp.startedAt, byId: insp.createdBy, by: nameOf(insp.createdBy) });
      }
      if (insp?.completedAt) {
        events.push({ type: 'QC_COMPLETED', label: `QC inspection completed${insp.overallStatus ? ` (${insp.overallStatus})` : ''}`, at: insp.completedAt, byId: insp.completedBy, by: nameOf(insp.completedBy) });
      }
      if (card?.createdAt) {
        events.push({ type: 'JOB_CARD_CREATED', label: 'Job card created', at: card.createdAt, byId: card.createdBy, by: nameOf(card.createdBy) });
      }
      if (card?.sharedAt) {
        events.push({ type: 'JOB_CARD_SHARED', label: 'Job card shared with customer', at: card.sharedAt, byId: card.updatedBy, by: nameOf(card.updatedBy) });
      }
      if (card?.approvedAt) {
        events.push({
          type: 'JOB_CARD_APPROVED',
          label: 'Job card approved by customer',
          at: card.approvedAt,
          byId: vehicle.customerId,
          by: customerName,
        });
      }

      // Technician timeline — per item, in this card.
      const cardItems = card ? (itemsByCard[card.id] ?? []) : [];
      for (const it of cardItems) {
        // Tech assigned to this item. The `by` is the SA who performed the
        // assignment (captured on job_card_items.assigned_by) — falling back
        // to the card's createdBy if the row predates that column.
        if (it.assignedAt && it.assignedTechnicianId) {
          const techName = nameOf(it.assignedTechnicianId) ?? 'technician';
          const assignerId = it.assignedBy ?? card?.createdBy ?? null;
          events.push({
            type: 'TECHNICIAN_ASSIGNED',
            label: `Job "${it.jobDescription}" assigned to ${techName}`,
            at: it.assignedAt,
            byId: assignerId,
            by: nameOf(assignerId),
          });
        }
        // Each open/close session emits a started + (paused | completed) event.
        const logs = (logsByItem[it.id] ?? []).slice().sort(
          (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
        );
        for (const l of logs) {
          const tech = nameOf(l.technicianId);
          events.push({
            type: 'WORK_STARTED',
            label: `${tech ?? 'Technician'} started "${it.jobDescription}"`,
            at: l.startedAt,
            byId: l.technicianId,
            by: tech,
          });
          if (l.pausedAt) {
            // Distinguish a pause from a completion: if the item's completedAt
            // matches this session's pausedAt, treat this as the closing
            // session. Otherwise it's an intermediate pause.
            const isCompletion = it.completedAt
              && Math.abs(new Date(l.pausedAt).getTime() - new Date(it.completedAt).getTime()) < 1500;
            if (isCompletion) {
              events.push({
                type: 'WORK_COMPLETED',
                label: `${tech ?? 'Technician'} completed "${it.jobDescription}"`,
                at: l.pausedAt,
                byId: it.completedBy ?? l.technicianId,
                by: nameOf(it.completedBy) ?? tech,
              });
            } else {
              events.push({
                type: 'WORK_PAUSED',
                label: `${tech ?? 'Technician'} paused "${it.jobDescription}"`,
                at: l.pausedAt,
                byId: l.technicianId,
                by: tech,
              });
            }
          }
        }
        // Edge case: item completed but no open session was running (auto-pause
        // already emitted COMPLETED above). If completedAt has no matching log
        // pause within tolerance, emit a standalone completion event.
        if (it.completedAt) {
          const matched = logs.some((l) => l.pausedAt && Math.abs(
            new Date(l.pausedAt).getTime() - new Date(it.completedAt!).getTime(),
          ) < 1500);
          if (!matched) {
            events.push({
              type: 'WORK_COMPLETED',
              label: `${nameOf(it.completedBy) ?? 'Technician'} completed "${it.jobDescription}"`,
              at: it.completedAt,
              byId: it.completedBy,
              by: nameOf(it.completedBy),
            });
          }
        }
      }

      if (c.completedAt) {
        const isCancelled = c.status === 'CANCELLED';
        // For non-cancelled completions the actor is usually the customer
        // (job-card approval) and is captured on the JOB_CARD_APPROVED event.
        // We only attribute the close itself for explicit cancellations.
        const completedActorId = isCancelled ? c.updatedBy : null;
        events.push({
          type: isCancelled ? 'VISIT_CANCELLED' : 'VISIT_COMPLETED',
          label: isCancelled ? 'Visit cancelled' : 'Visit completed',
          at: c.completedAt,
          byId: completedActorId,
          by: nameOf(completedActorId),
        });
      }

      // Gate pass issue + the actual EXIT. Pairs with the ENTRY event above so
      // the timeline covers the full in/out cycle for each visit.
      for (const gp of passesByCheckIn[c.id] ?? []) {
        if (gp.generatedAt) {
          events.push({
            type: 'GATE_PASS_ISSUED',
            label: `Gate pass ${gp.code} issued`,
            at: gp.generatedAt,
            byId: gp.generatedBy,
            by: nameOf(gp.generatedBy),
          });
        }
        if (gp.redeemedAt) {
          const detail = [
            gp.odometerOut != null ? `${gp.odometerOut} km` : null,
            gp.driverOutName ? `driver ${gp.driverOutName}` : null,
          ].filter(Boolean).join(', ');
          events.push({
            type: 'EXIT',
            label: `Vehicle released at gate${detail ? ` (${detail})` : ''}`,
            at: gp.redeemedAt,
            byId: gp.redeemedBy,
            by: nameOf(gp.redeemedBy),
          });
        }
      }

      events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      const isCurrentVisit = c.id === latestCheckInId && isInsideWorkshop;

      return {
        id:              c.id,
        checkInTime:     c.checkInTime,
        completedAt:     c.completedAt,
        status:          c.status,
        displayStatus:   isCurrentVisit ? 'Current Service' : null,
        odometerReading: c.odometerReading,
        isCurrentVisit,
        photos:          await Promise.all(
          (c.isActive
            ? activePhotos.map((p: any) => ({
                id: p.id,
                vehicleCheckInId: c.id,
                photoType: p.imageCategory,
                imageUrl: p.imagePath,
                createdAt: p.createdAt,
              }))
            : (photosByCheckIn[c.id] ?? [])
          ).map(async (p: any) => ({
            ...p,
            imageUrl: await signUrl(p.imageUrl),
          })),
        ),
        inspection:      insp,
        jobCard:         card,
        appointment:     apptByCheckIn[c.id] ?? null,
        events,
      };
    }));

    return success('Visit history fetched successfully', data);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Vehicle Makes ────────────────────────────────────────────────────────
export async function getVehicleMakes(_request: FastifyRequest) {
  try {
    const makes = await db
      .select()
      .from(vehicleMakes)
      .orderBy(asc(vehicleMakes.name));

    return success('Vehicle makes fetched successfully', makes);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add Vehicle Make ─────────────────────────────────────────────────────────
export async function addVehicleMake(request: FastifyRequest) {
  try {
    const { name } = request.body as any;

    const [existing] = await db
      .select({ id: vehicleMakes.id })
      .from(vehicleMakes)
      .where(ilike(vehicleMakes.name, name))
      .limit(1);

    if (existing) {
      return error(HttpStatus.CONFLICT, 'Vehicle make already exists');
    }

    const [make] = await db.insert(vehicleMakes).values({ name }).returning();

    return created('Vehicle make added successfully', make);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Vehicle Models ───────────────────────────────────────────────────────
export async function getVehicleModels(request: FastifyRequest) {
  try {
    const { makeId } = request.params as any;

    const [make] = await db
      .select({ id: vehicleMakes.id, name: vehicleMakes.name })
      .from(vehicleMakes)
      .where(eq(vehicleMakes.id, makeId))
      .limit(1);

    if (!make) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle make not found');
    }

    let models = await db
      .select()
      .from(vehicleModels)
      .where(eq(vehicleModels.makeId, makeId))
      .orderBy(asc(vehicleModels.name));

    if (models.length === 0) {
      try {
        console.log('No models found for this make. Fetching from IRM...');
        const seriesList = await fetchSeriesForMake(make.name);
        if (seriesList.length > 0) {
          models = await db
            .insert(vehicleModels)
            .values(seriesList.map((s: any) => ({ makeId, name: s.name ?? s })))
            .returning();
        }
      } catch (err) {
        console.error('[Vehicle] Failed to fetch series from IRM:', err);
      }
    }

    return success('Vehicle models fetched successfully', models);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Model Codes (Make → Series → ModelCode) ──────────────────────────────
// Returns the model codes for a given Series (vehicle_models row). Cache-first:
// serves from vehicle_model_codes; on a miss, calls IRM_GetModelCodes once,
// persists the result, and returns it. Never throws to the caller — an Evolve
// failure / timeout returns an empty list so the picker degrades gracefully.
export async function getModelCodes(request: FastifyRequest) {
  try {
    const { modelId } = request.params as any;

    // Resolve the series (model) + the parent make's Evolve code.
    const [model] = await db
      .select({
        id: vehicleModels.id,
        name: vehicleModels.name,
        makeCode: vehicleMakes.code,
        makeName: vehicleMakes.name,
      })
      .from(vehicleModels)
      .innerJoin(vehicleMakes, eq(vehicleMakes.id, vehicleModels.makeId))
      .where(eq(vehicleModels.id, modelId))
      .limit(1);

    if (!model) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle model not found');
    }

    // Cache-first.
    let codes = await db
      .select()
      .from(vehicleModelCodes)
      .where(eq(vehicleModelCodes.modelId, modelId))
      .orderBy(asc(vehicleModelCodes.description), asc(vehicleModelCodes.modelYear));

    if (codes.length === 0) {
      try {
        const makeParam = model.makeCode || model.makeName;
        const fetched = await fetchModelCodesForSeries(makeParam, model.name);
        if (fetched.length > 0) {
          await db
            .insert(vehicleModelCodes)
            .values(
              fetched.map((f) => ({
                modelId,
                code: f.code,
                mandmCode: f.mandmCode,
                description: f.description,
                modelYear: f.year,
              })),
            )
            .onConflictDoUpdate({
              target: [vehicleModelCodes.modelId, vehicleModelCodes.code, vehicleModelCodes.modelYear],
              set: {
                mandmCode: sql`excluded.mandm_code`,
                description: sql`excluded.description`,
                updatedAt: new Date(),
              },
            });
          codes = await db
            .select()
            .from(vehicleModelCodes)
            .where(eq(vehicleModelCodes.modelId, modelId))
            .orderBy(asc(vehicleModelCodes.description), asc(vehicleModelCodes.modelYear));
        }
      } catch (err) {
        console.error('[Vehicle] Failed to fetch model codes from IRM:', err);
      }
    }

    return success('Vehicle model codes fetched successfully', codes);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add Vehicle Model ────────────────────────────────────────────────────────
export async function addVehicleModel(request: FastifyRequest) {
  try {
    const { makeId, name } = request.body as any;

    const [make] = await db
      .select({ id: vehicleMakes.id })
      .from(vehicleMakes)
      .where(eq(vehicleMakes.id, makeId))
      .limit(1);

    if (!make) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle make not found');
    }

    const [existing] = await db
      .select({ id: vehicleModels.id })
      .from(vehicleModels)
      .where(and(eq(vehicleModels.makeId, makeId), ilike(vehicleModels.name, name)))
      .limit(1);

    if (existing) {
      return error(HttpStatus.CONFLICT, 'Vehicle model already exists for this make');
    }

    const [model] = await db.insert(vehicleModels).values({ makeId, name }).returning();

    return created('Vehicle model added successfully', model);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── VIN Lookup ───────────────────────────────────────────────────────────────
export async function vinLookup(request: FastifyRequest) {
  try {
    const { vin, reg, companyId } = request.body as { vin?: string; reg?: string; companyId?: string };
    const vinTerm = vin?.trim() ?? '';
    const regTerm = reg?.trim() ?? '';
    const term = vinTerm || regTerm;

    if (!term) {
      return error(HttpStatus.BAD_REQUEST, 'VIN or registration number is required');
    }

    // Company-aware search (AI-2). Resolve the selected company to its Evolve
    // InterfaceCode via the single CompanyResolver, mirroring the appointment
    // search. Backward compatible: no / unknown / inactive companyId → undefined
    // → the Evolve request falls back to env.EVOLVE_INTERFACE_CODE as before.
    const interfaceCode = companyId
      ? (await companyResolver.resolveInterfaceCode(companyId)) ?? undefined
      : undefined;

    // Route to the matching Evolve search — VIN if FE marked it as VIN,
    // RegistrationNo if FE marked it as registration. Fall back to the
    // opposite field if the first call returns nothing (safety net for
    // edge cases where the FE heuristic misclassifies).
    let irmResult: any = { found: false, CustomerDetail: {}, CustomerProfile: {}, Vehicles: {}, AccountsReceivable: {} };
    try {
      if (vinTerm) {
        irmResult = await lookupVehicleByVin(vinTerm, interfaceCode);
        if (!irmResult.found) {
          irmResult = await lookupCustomer({ reg: vinTerm, interfaceCode });
        }
      } else {
        irmResult = await lookupCustomer({ reg: regTerm, interfaceCode });
        if (!irmResult.found) {
          irmResult = await lookupVehicleByVin(regTerm, interfaceCode);
        }
      }
    } catch (irmErr) {
      console.log('vinLookup: Evolve IRM unavailable :- ', irmErr);
    }

    if (irmResult.found) {
      // Read-only lookup: do NOT persist here. Persistence happens later when
      // the user explicitly confirms (Add Customer / Check-In). This prevents
      // accidentally bloating the DB with browsed-but-not-added vehicles.
      // Still return localCustomerId / localVehicleId if the customer/vehicle
      // already exists from a prior submission, so the FE knows.
      let localCustomerId: string | null = null;
      let localVehicleId: string | null = null;

      const custSeq = irmResult.CustomerDetail?.CustSequenceID;
      if (custSeq) {
        const [c] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.custSequenceId, String(custSeq).trim()), isNull(customers.deletedAt)))
          .limit(1);
        localCustomerId = c?.id ?? null;
      }

      const vinFromEvolve = irmResult.Vehicles?.VehVinNumber;
      if (vinFromEvolve) {
        const [v] = await db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(and(eq(vehicles.vin, String(vinFromEvolve).trim()), isNull(vehicles.deletedAt)))
          .limit(1);
        localVehicleId = v?.id ?? null;
      }

      // Fallback: a vehicle created from a prior Evolve pre-fill may be stored
      // under a different VIN than Evolve now returns, while still matching the
      // searched VIN/registration. Match on the searched term (case-insensitive,
      // exact) so an existing local vehicle is recognised as a re-entry instead
      // of being treated as a brand-new add.
      if (!localVehicleId) {
        const [v] = await db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(
            and(
              or(ilike(vehicles.vin, term), ilike(vehicles.registrationNumber, term)),
              isNull(vehicles.deletedAt),
            ),
          )
          .limit(1);
        localVehicleId = v?.id ?? null;
      }

      return success('VIN lookup completed', {
        source: 'evolve',
        customerId: localCustomerId,
        vehicleId: localVehicleId,
        ...irmResult,
      });
    }

    // 2) Fall back to local DB search (VIN or registration, ILIKE)
    const localRows = await db
      .select()
      .from(vehicles)
      .where(
        or(
          ilike(vehicles.vin, `%${term}%`),
          ilike(vehicles.registrationNumber, `%${term}%`),
        ),
      )
      .limit(20);

    return success('VIN lookup completed', {
      source: 'local',
      found: localRows.length > 0,
      vehicles: localRows,
      CustomerDetail: {},
      CustomerProfile: {},
      Vehicles: {},
      AccountsReceivable: {},
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
