import { FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, gte, isNull, isNotNull, lte, inArray, or, ilike, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  appointments,
  appointmentReschedules,
  customers,
  customerContacts,
  customerAr,
  vehicles,
  vehicleCheckIns,
  users,
  jobCards,
  slotConfigurations,
  customerCompanyLinks,
  workshopBays,
} from '../../db/models';
import {
  createAppointmentSchema,
  updateAppointmentStatusSchema,
  rescheduleAppointmentSchema,
  linkCheckInSchema,
  appointmentIdParamSchema,
  vehicleIdParamSchema,
  appointmentListQuerySchema,
  slotAvailabilityQuerySchema,
  irmSearchQuerySchema,
  SERVICE_DURATION_MAP,
  estimatedDurationMinutesField,
} from './dto';
import { randomUUID } from 'crypto';
import { ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { success, successWithMeta, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { lookupCustomer, lookupCustomers, lookupCustomersOnly, splitEvolvePhone, phoneSearchCandidates } from '../../services/evolveIrm.service';
import type { CustomerVehicleLookupResult, IrmSearchResult } from '../../services/evolveIrm.service';
import { persistEvolveCustomer } from '../../services/evolveCustomerPersist.service';
import { syncCustomerToEvolve } from '../../services/customerEvolveSync.service';
import { companyResolver } from '../../services/companyResolver.service';
import type { ResolvedCompany } from '../../services/companyResolver.service';
import { env } from '../../config/env';
import { resolveAndPersistModelCode } from '../../services/vehicleModelCode.service';
import { resolveActorId } from '../../shared/utils/resolveActor';
import {
  getBayAvailabilityForDate,
  checkBayIntervalConflict,
  loadBayOccupancy,
  findOverlappingBooking,
  findConflictingAppointment,
  assertIntervalFree,
  validateBayInterval,
  freeWindows,
  resolveRescheduleDuration,
  toMinutes,
  fromMinutes,
  WORKSHOP_OPEN,
  WORKSHOP_CLOSE,
} from './bayAvailability';
import { reallocateAppointmentBaySchema } from './dto';
import { sendAppointmentConfirmationEmail, sendAppointmentCancellationEmail, sendAppointmentRescheduleEmail } from '../../services/email.service';

// Second join to users: `users` is already joined for the service advisor, so
// the appointment's CREATOR (appointments.created_by) needs its own alias.
const creators = alias(users, 'creators');

// Thrown inside transactions to roll back the tx and surface a friendly HTTP
// status to the caller. Distinguishes deliberate guard failures from unexpected
// errors so the outer catch can format them differently.
class HttpError extends Error {
  constructor(public httpCode: number, message: string) {
    super(message);
  }
}

// ─── Generate Booking Ref ─────────────────────────────────────────────────────
async function generateBookingRef(): Promise<string> {
  const result = await db.execute(sql`SELECT nextval('apt_seq') AS seq_val`);
  const seqVal = (result.rows[0] as any).seq_val;
  return `APT-${String(Number(seqVal)).padStart(5, '0')}`;
}

// ─── Shared Slot Capacity Check ───────────────────────────────────────────────
async function assertSlotAvailable(
  date: string,
  time: string,
  excludeAppointmentId?: string,
): Promise<string | null> {
  const [slotConfig] = await db
    .select({ capacity: slotConfigurations.capacity })
    .from(slotConfigurations)
    .where(and(eq(slotConfigurations.time, time), eq(slotConfigurations.isActive, true)))
    .limit(1);

  if (!slotConfig) {
    return `The time slot ${time} is not available.`;
  }

  const conditions = [
    eq(appointments.appointmentDate, date),
    eq(appointments.appointmentTime, time),
    inArray(appointments.status, ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE']),
    isNull(appointments.deletedAt),
  ];
  if (excludeAppointmentId) {
    conditions.push(ne(appointments.id, excludeAppointmentId));
  }

  const [{ slotCount }] = await db
    .select({ slotCount: count() })
    .from(appointments)
    .where(and(...conditions));

  if (Number(slotCount) >= slotConfig.capacity) {
    return `The slot at ${time} on ${date} is fully booked. Please select another slot.`;
  }

  return null;
}

// ─── Get Slot Availability ────────────────────────────────────────────────────
export async function getSlotAvailability(request: FastifyRequest) {
  try {
    const { date } = request.query as any;

    const slotConfigs = await db
      .select({
        time: slotConfigurations.time,
        capacity: slotConfigurations.capacity,
      })
      .from(slotConfigurations)
      .where(eq(slotConfigurations.isActive, true))
      .orderBy(asc(slotConfigurations.time));

    const bookings = await db
      .select({
        appointmentTime: appointments.appointmentTime,
        booked: count(),
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.appointmentDate, date),
          inArray(appointments.status, ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE']),
          isNull(appointments.deletedAt),
        ),
      )
      .groupBy(appointments.appointmentTime);

    const bookedMap = new Map(bookings.map((b: any) => [b.appointmentTime, Number(b.booked)]));

    const slots = slotConfigs.map(({ time, capacity }: any) => {
      const booked = bookedMap.get(time) ?? 0;
      let status: 'available' | 'limited' | 'full' | 'closed';
      if (booked === 0) status = 'available';
      else if (booked < capacity) status = 'limited';
      else status = 'full';

      return { time, booked, capacity, status };
    });

    return success('Slot availability fetched successfully', { date, slots });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Bay Availability (per-bay, duration-aware) ───────────────────────────────
// Returns each bay's status + free windows for a date so the receptionist can
// pick a bay and a valid start time. Read-only; the authoritative conflict check
// runs again server-side at appointment creation (checkBayIntervalConflict).
export async function getBayAvailability(request: FastifyRequest) {
  try {
    const { date, excludeAppointmentId } = request.query as {
      date?: string;
      excludeAppointmentId?: string;
    };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return error(HttpStatus.BAD_REQUEST, 'A valid date (YYYY-MM-DD) is required', 'date');
    }
    const data = await getBayAvailabilityForDate(date, excludeAppointmentId);
    return success('Bay availability fetched successfully', { date, ...data });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Foreman: Bay alternatives for an appointment (Model A) ────────────────────
// For the appointment's exact [start, start+duration) interval, return every
// active bay with: whether it fits the full interval, and which appointment (if
// any) currently occupies it during that interval. The foreman UI uses this to
// pick a target bay, and — for the occupant it clashes with — calls this again
// (for that occupant's id) to list suitable replacement bays.
export async function getBayAlternatives(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const { excludeBayIds } = request.query as { excludeBayIds?: string };

    const [appt] = await db
      .select({
        id: appointments.id,
        bayId: appointments.bayId,
        date: appointments.appointmentDate,
        time: appointments.appointmentTime,
        duration: appointments.estimatedDurationMinutes,
        vehicleReg: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
      })
      .from(appointments)
      .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);

    if (!appt) return error(HttpStatus.NOT_FOUND, 'Appointment not found');
    if (!appt.bayId) return error(HttpStatus.BAD_REQUEST, 'This appointment has no bay reservation to change.');

    const startMin = toMinutes(appt.time);
    const endMin = startMin + (appt.duration ?? 0);
    const openMin = toMinutes(WORKSHOP_OPEN);
    const closeMin = toMinutes(WORKSHOP_CLOSE);
    const excluded = new Set((excludeBayIds ?? '').split(',').map((s) => s.trim()).filter(Boolean));

    const [currentBay] = await db
      .select({ bayNo: workshopBays.bayNo })
      .from(workshopBays)
      .where(eq(workshopBays.id, appt.bayId))
      .limit(1);

    const bayRows = await db
      .select({
        id: workshopBays.id,
        bayNo: workshopBays.bayNo,
        category: workshopBays.category,
        location: workshopBays.location,
        capabilities: workshopBays.capabilities,
        isActive: workshopBays.isActive,
      })
      .from(workshopBays)
      .orderBy(workshopBays.bayNo);

    // Occupancy for the date, excluding THIS appointment (so its own bay reads free).
    const occupancy = await loadBayOccupancy(appt.date, appt.id);

    const bays = bayRows.map((bay) => {
      const booked = (occupancy.get(bay.id) ?? []).map((b) => ({ start: b.startMin, end: b.endMin }));
      const fitsInterval =
        bay.isActive &&
        !excluded.has(bay.id) &&
        validateBayInterval(appt.time, appt.duration ?? 0, booked, openMin, closeMin).valid;
      const clash = findOverlappingBooking(occupancy.get(bay.id) ?? [], startMin, endMin);
      const windows = bay.isActive ? freeWindows(openMin, closeMin, booked) : [];
      return {
        id: bay.id,
        bayNo: bay.bayNo,
        category: bay.category ?? null,
        location: bay.location ?? null,
        capabilities: bay.capabilities ?? [],
        isActive: bay.isActive,
        fitsInterval,
        occupiedBy: clash
          ? {
              appointmentId: clash.appointmentId,
              vehicleReg: clash.vehicleReg,
              appointmentTime: clash.appointmentTime,
              endTime: fromMinutes(clash.endMin),
            }
          : null,
        available: windows.map((w) => ({ start: fromMinutes(w.start), end: fromMinutes(w.end) })),
      };
    });

    return success('Bay alternatives fetched', {
      appointment: {
        id: appt.id,
        appointmentDate: appt.date,
        appointmentTime: appt.time,
        endTime: fromMinutes(endMin),
        estimatedDurationMinutes: appt.duration ?? 0,
        currentBayId: appt.bayId,
        currentBayNo: currentBay?.bayNo ?? null,
        vehicleReg: appt.vehicleReg ?? null,
        vehicleName: `${appt.vehicleBrand ?? ''} ${appt.vehicleModel ?? ''}`.trim() || null,
      },
      operating: { start: WORKSHOP_OPEN, end: WORKSHOP_CLOSE },
      bays,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Foreman: Atomic bay reallocation / displacement swap (Model A) ────────────
// Moves the appointment (:id) to targetBayId. If the target is occupied by
// another appointment during the same interval, that occupant is atomically
// moved to replacementBayId (required in that case). All-or-nothing: one DB
// transaction guarded by per-(bay,date) advisory locks, with a final
// availability re-check INSIDE the transaction. Operates only on
// appointments.bay_id — never touches workshop_allocations (Model B).
export async function reallocateAppointmentBay(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const parsed = reallocateAppointmentBaySchema.safeParse(request.body);
    if (!parsed.success) {
      return error(HttpStatus.BAD_REQUEST, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { targetBayId, replacementBayId } = parsed.data;

    // 1. Load the appointment being moved (Appointment A).
    const [appt] = await db
      .select({
        id: appointments.id,
        bayId: appointments.bayId,
        date: appointments.appointmentDate,
        time: appointments.appointmentTime,
        duration: appointments.estimatedDurationMinutes,
      })
      .from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);

    if (!appt) return error(HttpStatus.NOT_FOUND, 'Appointment not found');
    if (!appt.bayId) return error(HttpStatus.BAD_REQUEST, 'This appointment has no bay reservation to change.');
    if (targetBayId === appt.bayId) {
      return error(HttpStatus.BAD_REQUEST, 'The target bay is the same as the current bay.', 'targetBayId');
    }

    // 2. Target bay must exist + be active.
    const [targetBay] = await db
      .select({ id: workshopBays.id, bayNo: workshopBays.bayNo, isActive: workshopBays.isActive })
      .from(workshopBays)
      .where(eq(workshopBays.id, targetBayId))
      .limit(1);
    if (!targetBay) return error(HttpStatus.BAD_REQUEST, 'Target bay not found.', 'targetBayId');
    if (!targetBay.isActive) return error(HttpStatus.BAD_REQUEST, 'Target bay is out of service.', 'targetBayId');

    const durationA = appt.duration ?? 0;

    // Advisory-lock every (bay, date) the swap could write, in a stable order to
    // avoid deadlocks. Reuses the createAppointment lock-key convention.
    const lockBayIds = [appt.bayId, targetBayId, ...(replacementBayId ? [replacementBayId] : [])]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();

    const result = await db.transaction(async (tx: any) => {
      for (const bId of lockBayIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${bId}:${appt.date}`}))`);
      }

      // 3. Re-check (inside the lock): is the target occupied during A's interval?
      const displaced = await findConflictingAppointment(appt.date, targetBayId, appt.time, durationA, appt.id);

      if (!displaced) {
        // ── Free-target move ── A simply moves to the target bay.
        const conflict = await assertIntervalFree(appt.date, targetBayId, appt.time, durationA, [appt.id]);
        if (conflict) throw new HttpError(HttpStatus.CONFLICT, conflict);
        await tx.update(appointments).set({ bayId: targetBayId, updatedAt: new Date() }).where(eq(appointments.id, appt.id));
        return {
          mode: 'MOVE' as const,
          appointment: { id: appt.id, fromBayId: appt.bayId, toBayId: targetBayId },
          displaced: null,
        };
      }

      // ── Displacement swap ── target occupied → replacement required.
      if (!replacementBayId) {
        throw new HttpError(HttpStatus.BAD_REQUEST, 'The target bay is occupied; a replacement bay for the displaced appointment is required.');
      }
      if (replacementBayId === targetBayId) {
        throw new HttpError(HttpStatus.BAD_REQUEST, 'Replacement bay cannot be the target bay.');
      }
      if (replacementBayId === appt.bayId) {
        throw new HttpError(HttpStatus.BAD_REQUEST, "Replacement bay cannot be the moved appointment's current bay.");
      }

      // Load displaced appointment C's interval authoritatively.
      const [apptC] = await tx
        .select({
          id: appointments.id,
          bayId: appointments.bayId,
          date: appointments.appointmentDate,
          time: appointments.appointmentTime,
          duration: appointments.estimatedDurationMinutes,
        })
        .from(appointments)
        .where(and(eq(appointments.id, displaced.appointmentId), isNull(appointments.deletedAt)))
        .limit(1);
      if (!apptC) throw new HttpError(HttpStatus.CONFLICT, 'The occupying appointment changed. Please refresh and try again.');
      const durationC = apptC.duration ?? 0;

      // Replacement bay must exist + be active + free for C's FULL interval.
      const [replBay] = await tx
        .select({ id: workshopBays.id, bayNo: workshopBays.bayNo, isActive: workshopBays.isActive })
        .from(workshopBays)
        .where(eq(workshopBays.id, replacementBayId))
        .limit(1);
      if (!replBay) throw new HttpError(HttpStatus.BAD_REQUEST, 'Replacement bay not found.');
      if (!replBay.isActive) throw new HttpError(HttpStatus.BAD_REQUEST, 'Replacement bay is out of service.');

      const replConflict = await assertIntervalFree(apptC.date, replacementBayId, apptC.time, durationC, [apptC.id]);
      if (replConflict) {
        throw new HttpError(HttpStatus.CONFLICT, 'No alternative bay is available for the displaced appointment’s full duration.');
      }

      // Target must fit A once C has left (exclude BOTH A and C).
      const targetConflict = await assertIntervalFree(appt.date, targetBayId, appt.time, durationA, [appt.id, apptC.id]);
      if (targetConflict) {
        throw new HttpError(HttpStatus.CONFLICT, 'The target bay has another conflicting booking for this time.');
      }

      // 4. Atomic swap — both updates in this transaction.
      await tx.update(appointments).set({ bayId: replacementBayId, updatedAt: new Date() }).where(eq(appointments.id, apptC.id));
      await tx.update(appointments).set({ bayId: targetBayId, updatedAt: new Date() }).where(eq(appointments.id, appt.id));

      return {
        mode: 'SWAP' as const,
        appointment: { id: appt.id, fromBayId: appt.bayId, toBayId: targetBayId },
        displaced: { id: apptC.id, fromBayId: apptC.bayId, toBayId: replacementBayId },
      };
    });

    return success(result.mode === 'SWAP' ? 'Bays swapped' : 'Appointment moved to bay', result);
  } catch (err) {
    if (err instanceof HttpError) return error(err.httpCode, err.message);
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── List Appointments ────────────────────────────────────────────────────────
export async function listAppointments(request: FastifyRequest) {
  try {
    const query = appointmentListQuerySchema.parse(request.query ?? {});
    const { date, dateFrom, dateTo, status, serviceAdvisorId, customerId, search, page, limit } = query;

    const conditions: any[] = [isNull(appointments.deletedAt)];

    if (date) {
      conditions.push(eq(appointments.appointmentDate, date));
    } else {
      if (dateFrom) conditions.push(gte(appointments.appointmentDate, dateFrom));
      if (dateTo) conditions.push(lte(appointments.appointmentDate, dateTo));
    }

    if (status) conditions.push(eq(appointments.status, status as any));
    if (serviceAdvisorId) conditions.push(eq(appointments.serviceAdvisorId, serviceAdvisorId));
    if (customerId) conditions.push(eq(appointments.customerId, customerId));

    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(
          ilike(appointments.bookingRef, like),
          ilike(vehicles.registrationNumber, like),
          ilike(vehicles.vin, like),
          ilike(customers.firstName, like),
          ilike(customers.lastName, like),
          sql`EXISTS (
            SELECT 1 FROM customer_contacts cc
            WHERE cc.customer_id = ${appointments.customerId}
              AND cc.contact_number ILIKE ${like}
          )`,
        ),
      );
    }

    const whereClause = and(...conditions);
    const offset = (page - 1) * limit;

    const [totalRow] = await db
      .select({ total: count() })
      .from(appointments)
      .leftJoin(customers, eq(appointments.customerId, customers.id))
      .leftJoin(vehicles, eq(appointments.vehicleId, vehicles.id))
      .where(whereClause);
    const total = Number(totalRow?.total ?? 0);

    const rows = await db
      .select({
        id: appointments.id,
        bookingRef: appointments.bookingRef,
        serviceType: appointments.serviceType,
        appointmentDate: appointments.appointmentDate,
        appointmentTime: appointments.appointmentTime,
        status: appointments.status,
        estimatedDurationMinutes: appointments.estimatedDurationMinutes,
        // Needed by the reschedule modal to decide between the bay picker and
        // the capacity-slot grid, and to pre-select the current bay.
        bayId: appointments.bayId,
        pickupRequired: appointments.pickupRequired,
        createdAt: appointments.createdAt,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerCompanyName: customers.companyName,
        customerPhone: sql<string>`(
          SELECT cc.contact_number FROM customer_contacts cc
          WHERE cc.customer_id = ${appointments.customerId}
            AND cc.contact_type = 'MOBILE'
          LIMIT 1
        )`,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        vehicleYear: vehicles.manufacturingYear,
        vehicleReg: vehicles.registrationNumber,
        vehicleVin: vehicles.vin,
        advisorUsername: users.username,
        // Who booked the appointment. Distinct from the service advisor —
        // left join because created_by is nullable on older rows.
        createdByName: creators.username,
        internalNotes: appointments.internalNotes,
        rescheduleCount: appointments.rescheduleCount,
      })
      .from(appointments)
      .leftJoin(customers, eq(appointments.customerId, customers.id))
      .leftJoin(vehicles, eq(appointments.vehicleId, vehicles.id))
      .leftJoin(users, eq(appointments.serviceAdvisorId, users.id))
      .leftJoin(creators, eq(appointments.createdBy, creators.id))
      .where(whereClause)
      .orderBy(desc(appointments.createdAt))
      .limit(limit)
      .offset(offset);

    // Stats for today
    const today = new Date().toISOString().split('T')[0];
    const [statsRow] = await db
      .select({ total: count() })
      .from(appointments)
      .where(and(eq(appointments.appointmentDate, today), isNull(appointments.deletedAt)));

    const [confirmedRow] = await db
      .select({ total: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.appointmentDate, today),
          inArray(appointments.status, ['BOOKED', 'CONFIRMED']),
          isNull(appointments.deletedAt),
        ),
      );

    const [cancelledRow] = await db
      .select({ total: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.appointmentDate, today),
          eq(appointments.status, 'CANCELLED'),
          isNull(appointments.deletedAt),
        ),
      );

    return success('Appointments fetched successfully', {
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      stats: {
        todayTotal: Number(statsRow?.total ?? 0),
        todayConfirmed: Number(confirmedRow?.total ?? 0),
        todayCancelled: Number(cancelledRow?.total ?? 0),
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Appointment By ID ────────────────────────────────────────────────────
export async function getAppointmentById(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [row] = await db
      .select({
        appointment: appointments,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        vehicleYear: vehicles.manufacturingYear,
        vehicleReg: vehicles.registrationNumber,
        vehicleVin: vehicles.vin,
        advisorUsername: users.username,
      })
      .from(appointments)
      .leftJoin(customers, eq(appointments.customerId, customers.id))
      .leftJoin(vehicles, eq(appointments.vehicleId, vehicles.id))
      .leftJoin(users, eq(appointments.serviceAdvisorId, users.id))
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Appointment not found');
    }

    return success('Appointment fetched successfully', {
      ...row.appointment,
      customer: row.customerFirstName
        ? { firstName: row.customerFirstName, lastName: row.customerLastName }
        : null,
      vehicle: row.vehicleBrand
        ? {
            brand: row.vehicleBrand,
            model: row.vehicleModel,
            year: row.vehicleYear,
            registrationNumber: row.vehicleReg,
          }
        : null,
      advisor: row.advisorUsername ? { username: row.advisorUsername } : null,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create Appointment ───────────────────────────────────────────────────────
export async function createAppointment(request: FastifyRequest) {
  try {
    const parsed = createAppointmentSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first.path.join('.');
      return error(HttpStatus.BAD_REQUEST, `${path ? path + ': ' : ''}${first.message}`, path);
    }
    const body = parsed.data as any;

    // Company: if supplied, validate via the single CompanyResolver and resolve
    // it ONCE for reuse (Phase A validation/log + Phase B ownership). Null when
    // no company was supplied — omitting companyId behaves exactly as before.
    let resolvedCompany: ResolvedCompany | null = null;
    if (body.companyId) {
      resolvedCompany = await companyResolver.getById(body.companyId);
      if (!resolvedCompany || !resolvedCompany.isActive) {
        return error(HttpStatus.BAD_REQUEST, 'Invalid or inactive company', 'companyId');
      }
      console.log(`[createAppointment] company resolved: companyId=${resolvedCompany.id} companyCode=${resolvedCompany.code}`);
    }

    // Phase D: a company is REQUIRED when creating a NEW customer or vehicle.
    // Bookings that reference only existing records (customerId + vehicleId) are
    // unaffected. Gated by EVOLVE_MULTI_COMPANY_ENFORCEMENT; no-op when off.
    if (env.EVOLVE_MULTI_COMPANY_ENFORCEMENT && !resolvedCompany && (body.newCustomer || body.newVehicle)) {
      return error(HttpStatus.BAD_REQUEST, 'Company is required to create a new customer or vehicle', 'companyId');
    }

    // Resolve actor, guarding against tokens whose userId no longer exists in users table
    const createdBy = await resolveActorId(request);

    let customerId = body.customerId ?? null;
    // Tracks a customer NEWLY created in this call (for the post-commit Evolve
    // push). Stays null when an existing customer is matched/reused. Phase 3.
    let createdCustomerId: string | null = null;
    let vehicleId = body.vehicleId ?? null;

    // Cross-company guard for an EXISTING vehicle (Phase D). "A vehicle may only
    // be used within its owning company" — enforced here so a direct API call
    // passing a vehicleId owned by another company cannot bypass the rule.
    // Shares ownerCompanyIfDifferent with the VIN/reg guard. No-op when off.
    if (env.EVOLVE_MULTI_COMPANY_ENFORCEMENT && resolvedCompany && vehicleId) {
      const owner = await findVehicleOwnerByIdElsewhere(vehicleId, resolvedCompany.id);
      if (owner) {
        return error(
          HttpStatus.CONFLICT,
          `Vehicle belongs to another company (${owner.code})`,
          'companyId',
          { outcome: 'SWITCH_COMPANY', ownedByCompany: { code: owner.code } },
        );
      }
    }

    // 0. Pre-validate the new vehicle BEFORE touching the customer table, so
    //    we never leave a half-created customer behind when the VIN/plate
    //    belongs to someone else. The full reuse/insert logic still runs
    //    later (step 2) once we have a customerId.
    if (!vehicleId && body.newVehicle) {
      const nv = body.newVehicle;
      const knownCustomerId = customerId; // null when creating a new customer

      // Cross-company guard (Phase D). A VIN/reg owned by ANOTHER company must
      // not be booked under the selected company. Reuses the SAME ownership
      // resolver as the search flow (findVehicleOwnerElsewhere) — one source of
      // truth. The backend is authoritative; the FE switch prompt is only a
      // convenience. Gated by EVOLVE_MULTI_COMPANY_ENFORCEMENT; no-op when off.
      if (env.EVOLVE_MULTI_COMPANY_ENFORCEMENT && resolvedCompany) {
        const owner = await findVehicleOwnerElsewhere(
          nv.vin?.trim() || undefined,
          nv.registrationNumber?.trim() || undefined,
          resolvedCompany.id,
        );
        if (owner) {
          return error(
            HttpStatus.CONFLICT,
            `Vehicle belongs to another company (${owner.code})`,
            'companyId',
            { outcome: 'SWITCH_COMPANY', ownedByCompany: { code: owner.code } },
          );
        }
      }

      if (nv.vin?.trim()) {
        const [existing] = await db
          .select({ customerId: vehicles.customerId })
          .from(vehicles)
          .where(and(eq(vehicles.vin, nv.vin.trim()), ne(vehicles.status, 'Archived')))
          .limit(1);
        if (
          existing &&
          existing.customerId &&
          knownCustomerId &&
          existing.customerId !== knownCustomerId
        ) {
          return error(HttpStatus.CONFLICT, 'VIN already registered to another customer');
        }
        // If we don't have a customerId yet (new customer flow) and the VIN
        // belongs to ANY other customer, also reject — we'd be creating a
        // duplicate customer for a vehicle that already has an owner.
        if (existing && existing.customerId && !knownCustomerId) {
          return error(HttpStatus.CONFLICT, 'VIN already registered to another customer');
        }
      }

      if (nv.registrationNumber?.trim()) {
        const [existingReg] = await db
          .select({ customerId: vehicles.customerId })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.registrationNumber, nv.registrationNumber.trim()),
              ne(vehicles.status, 'Archived'),
            ),
          )
          .limit(1);
        if (
          existingReg &&
          existingReg.customerId &&
          knownCustomerId &&
          existingReg.customerId !== knownCustomerId
        ) {
          return error(
            HttpStatus.CONFLICT,
            'Registration number already registered to another customer',
          );
        }
        if (existingReg && existingReg.customerId && !knownCustomerId) {
          return error(
            HttpStatus.CONFLICT,
            'Registration number already registered to another customer',
          );
        }
      }
    }

    // Steps 1, 2, and 7 are wrapped in a single transaction so that a failure
    // anywhere (e.g. unique constraint violation on the vehicle insert) rolls
    // back any customer / contact / vehicle rows already inserted in this
    // request. Without this, a partially-failed booking would leave orphan
    // customer + contact rows behind, blocking the user from retrying.
    const { newAppointment, hasActiveJobCard } = await db.transaction(async (tx: any) => {

    // 1. Create new customer if needed.
    //    Policy: only create if BOTH email and phone are new. If either the
    //    email or the phone already belongs to another customer, reject the
    //    request so we never silently attach the appointment to the wrong
    //    person. (IRM-sourced customers with a custSequenceId bypass this
    //    check and are reused, since IRM is the source of truth there.)
    if (!customerId && body.newCustomer) {
      const nc = body.newCustomer;
      const email = nc.primaryEmail?.trim();
      const phone = nc.contactNumber?.trim();

      // a) IRM reuse — trusted external id
      if (nc.custSequenceId) {
        const [existing] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.custSequenceId, nc.custSequenceId), isNull(customers.deletedAt)))
          .limit(1);
        if (existing) customerId = existing.id;
      }

      if (!customerId) {
        // b) Reject if email is already taken
        if (email) {
          const [emailTaken] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(ilike(customers.primaryEmail, email), isNull(customers.deletedAt)))
            .limit(1);
          if (emailTaken) {
            throw new HttpError(HttpStatus.BAD_REQUEST, 'A customer already exists with this email.');
          }
        }

        // c) Reject if phone is already taken. Compare against the canonical
        // national number we store, so dedupe is format-agnostic.
        const phoneLocal = splitEvolvePhone(phone).number;
        if (phone) {
          const [phoneTaken] = await tx
            .select({ id: customers.id })
            .from(customers)
            .innerJoin(customerContacts, eq(customerContacts.customerId, customers.id))
            .where(and(eq(customerContacts.contactNumber, phoneLocal || phone), isNull(customers.deletedAt)))
            .limit(1);
          if (phoneTaken) {
            throw new HttpError(HttpStatus.BAD_REQUEST, 'A customer already exists with this phone number.');
          }
        }

        // d) Both are new → insert
        const [newCust] = await tx
          .insert(customers)
          .values({
            crmReferenceNo: nc.crmReferenceNo ?? '',
            custSequenceId: nc.custSequenceId || randomUUID(),
            // Was hardcoded 'C', which stored every customer booked through the
            // wizard as a company even when they were a walk-in individual. Now
            // driven by the form's Individual/Company selector; the DTO defaults
            // to 'C' so an older client that omits it is unaffected.
            customerType: nc.customerType,
            firstName: nc.firstName || null,
            lastName: nc.lastName || null,
            companyName: nc.companyName || null,
            // Type-specific identifiers: ID number for an individual, company
            // registration number for a company. The form only ever sends the
            // one that applies, so the other stays NULL.
            idNumber: nc.idNumber || null,
            regNo: nc.regNo || null,
            // Individual only — Evolve sends <Title>/<Initial> on the person
            // branch only.
            title: nc.title || null,
            initial: nc.initial || null,
            primaryEmail: email || null,
            // AR fields that live on `customers` rather than customer_ar (the
            // Evolve read contract returns both inside <CustomerDetail>).
            // Optional, like the rest of the AR capture.
            currencyCode: nc.currencyCode || null,
            defaultTaxCode: nc.defaultTaxCode ?? null,
            leadType: 'WALK_IN',
            leadSource: 'RECEPTION',
            activeCustomer: true,
          })
          .returning({ id: customers.id });
        customerId = newCust.id;
        createdCustomerId = newCust.id; // new local customer → eligible for Evolve push

        if (phone) {
          // Store canonical: CellphoneCode "27" + national number (trunk-0
          // stripped), matching what we sync to Evolve and what search expects.
          await tx.insert(customerContacts).values({
            customerId: newCust.id,
            contactType: 'MOBILE',
            countryCode: splitEvolvePhone(phone).code || '27',
            contactNumber: phoneLocal || phone,
          });
        }
      }
    }

    if (!customerId) {
      throw new HttpError(HttpStatus.BAD_REQUEST, 'Either customerId or newCustomer must be provided');
    }

    // 1a. Accounts Receivable (optional). Runs for a newly created customer AND
    // for one reused above — the branches at the top of this block silently
    // reuse an existing customer when the IRM sequence id, email or phone
    // matches, and AR typed on the booking form would otherwise be discarded
    // the way nc.address already is.
    //
    // FILL-BLANKS-ONLY: a row is inserted only when the customer has none. An
    // existing AR record is never modified — credit terms and limits are
    // finance data, and a receptionist booking a service should not be able to
    // overwrite them from this screen. Same guard the owning-company link uses
    // just below, and the same rule evolveCustomerPersist applies to engine
    // numbers. Fully skipped when the booking carries no AR values, so an
    // ordinary booking behaves exactly as before.
    if (body.newCustomer) {
      const nc = body.newCustomer;
      const arIn = nc.ar;
      const hasArValues = !!(
        arIn?.arAccountType?.trim() ||
        arIn?.arAccountNumber?.trim() ||
        arIn?.termsCode?.trim() ||
        arIn?.creditLimitAmount !== undefined ||
        arIn?.stopCredit ||
        arIn?.inactiveAccount
      );
      if (hasArValues) {
        const [existingAr] = await tx
          .select({ id: customerAr.id })
          .from(customerAr)
          .where(and(eq(customerAr.customerId, customerId), isNull(customerAr.deletedAt)))
          .limit(1);
        if (!existingAr) {
          await tx.insert(customerAr).values({
            customerId,
            arAccountType: arIn?.arAccountType?.trim() || null,
            arAccountNumber: arIn?.arAccountNumber?.trim() || null,
            termsCode: arIn?.termsCode?.trim() || null,
            // numeric column — drizzle takes a string. undefined → NULL, but 0
            // is a real credit limit and must survive.
            creditLimitAmount:
              arIn?.creditLimitAmount !== undefined ? String(arIn.creditLimitAmount) : null,
            stopCredit: arIn?.stopCredit ?? false,
            inactiveAccount: arIn?.inactiveAccount ?? false,
          });
        } else {
          console.warn(
            `[Appointments] customer ${customerId} already has an AR record — booking-form AR values ignored (fill-blanks-only)`,
          );
        }
      }
    }

    // 1b. Link the customer to the selected company (Phase B3). Idempotent:
    // ON CONFLICT DO NOTHING makes retries / duplicate submissions safe, and
    // covers both newly-created and reused/existing customers. No-op when no
    // company was selected. cust_sequence_id / crm_reference_no are filled per
    // company by Phase C.
    if (resolvedCompany) {
      await tx
        .insert(customerCompanyLinks)
        .values({ customerId, companyId: resolvedCompany.id })
        .onConflictDoNothing({
          target: [customerCompanyLinks.customerId, customerCompanyLinks.companyId],
        });
    }

    // 2. Create new vehicle if needed
    if (!vehicleId && body.newVehicle) {
      const nv = body.newVehicle;
      const vinValue = nv.vin?.trim() || `NO-VIN-${randomUUID().slice(0, 8).toUpperCase()}`;

      // VIN uniqueness — block if a non-archived vehicle with this VIN belongs
      // to a different customer; reuse silently if it belongs to this customer.
      if (nv.vin?.trim()) {
        const [existing] = await tx
          .select({ id: vehicles.id, customerId: vehicles.customerId })
          .from(vehicles)
          .where(and(eq(vehicles.vin, nv.vin.trim()), ne(vehicles.status, 'Archived')))
          .limit(1);
        if (existing) {
          if (existing.customerId && existing.customerId !== customerId) {
            throw new HttpError(
              HttpStatus.CONFLICT,
              'VIN already registered to another customer',
            );
          }
          vehicleId = existing.id;
        }
      }

      // registrationNumber uniqueness — same rule as VIN.
      if (!vehicleId && nv.registrationNumber?.trim()) {
        const [existingReg] = await tx
          .select({ id: vehicles.id, customerId: vehicles.customerId })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.registrationNumber, nv.registrationNumber.trim()),
              ne(vehicles.status, 'Archived'),
            ),
          )
          .limit(1);
        if (existingReg) {
          if (existingReg.customerId && existingReg.customerId !== customerId) {
            throw new HttpError(
              HttpStatus.CONFLICT,
              'Registration number already registered to another customer',
            );
          }
          vehicleId = existingReg.id;
        }
      }

      if (!vehicleId) {
        const [newVeh] = await tx
          .insert(vehicles)
          .values({
            customerId,
            brand:              nv.brand,
            model:              nv.model,
            manufacturingYear:  nv.manufacturingYear,
            vin:                vinValue,
            registrationNumber: nv.registrationNumber,
            fuelType:           nv.fuelType          ?? null,
            transmissionType:   nv.transmissionType  ?? null,
            odometerLast:       nv.odometerLast       ?? 0,
            engineNumber:       nv.engineNumber      || null,
            seriesDescription:  nv.seriesDescription || null,
            modelDescription:   nv.modelDescription  || null,
            modelCode:          nv.modelCode         || null,
            extColour:          nv.extColour         || null,
            registrationDate:   nv.registrationDate  || null,
            registrationYear:   nv.registrationYear  ?? null,
            dateFirstSold:      nv.sellingDate       || null,
          })
          .returning({ id: vehicles.id });
        vehicleId = newVeh.id;
      }
    }

    if (!vehicleId) {
      throw new HttpError(HttpStatus.BAD_REQUEST, 'Either vehicleId or newVehicle must be provided');
    }

    // 2b. Initialize vehicle ownership (Phase B1) — fill-blanks-only.
    // The guard `owning_company_id IS NULL` means we set it for a brand-new
    // vehicle or one that has no owner yet, but NEVER overwrite an existing
    // owner. Ownership transfers are authoritative Evolve events, not
    // appointment events (see ADR-001 Appendix B). No-op when no company chosen.
    if (resolvedCompany) {
      await tx
        .update(vehicles)
        .set({ owningCompanyId: resolvedCompany.id, updatedAt: new Date() })
        .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.owningCompanyId)));
    }

    // 2c. One open appointment per vehicle. A vehicle that already has a live
    // booking must not get a second one — that produced duplicate bookings for
    // the same vehicle on the same day (e.g. APT-00166 and APT-00167 both
    // holding Bay 1), which then reserve bays twice and confuse the foreman.
    //
    // "Live" = BOOKED / CONFIRMED / CHECKED_IN / IN_SERVICE. The terminal
    // statuses (COMPLETED / CANCELLED / NO_SHOW) and soft-deleted rows do NOT
    // block, so a vehicle can always be booked again once its last visit ends.
    //
    // The advisory lock serializes concurrent bookings for the SAME vehicle so
    // the check and the insert are race-free (mirrors the bay lock below; it is
    // released automatically at transaction end).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`vehicle-appt:${vehicleId}`}))`);
    const [openAppt] = await tx
      .select({
        bookingRef: appointments.bookingRef,
        appointmentDate: appointments.appointmentDate,
        appointmentTime: appointments.appointmentTime,
        status: appointments.status,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.vehicleId, vehicleId),
          inArray(appointments.status, ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE']),
          isNull(appointments.deletedAt),
        ),
      )
      .limit(1);

    if (openAppt) {
      throw new HttpError(
        HttpStatus.CONFLICT,
        `This vehicle already has an open appointment (${openAppt.bookingRef} on ${openAppt.appointmentDate} at ${openAppt.appointmentTime} — ${openAppt.status}). It can be booked again once that appointment is completed or cancelled.`,
      );
    }

    // 3. Availability — bay-scheduled bookings use per-bay, duration-aware
    // interval validation; capacity-slot bookings keep the existing check.
    // 5b. Resolve duration up front (needed by the bay interval check).
    const estimatedDurationMinutes =
      body.estimatedDurationMinutes ?? SERVICE_DURATION_MAP[body.serviceType] ?? 150;

    if (body.bayId) {
      // Serialize concurrent bookings for the same (bay, date) so the final
      // check + insert are race-free (auto-released at transaction end).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${body.bayId}:${body.appointmentDate}`}))`,
      );
      const bayError = await checkBayIntervalConflict(
        body.bayId,
        body.appointmentDate,
        body.appointmentTime,
        estimatedDurationMinutes,
      );
      if (bayError) throw new HttpError(HttpStatus.BAD_REQUEST, bayError);
    } else {
      const slotError = await assertSlotAvailable(body.appointmentDate, body.appointmentTime);
      if (slotError) throw new HttpError(HttpStatus.BAD_REQUEST, slotError);
    }

    // 4. Check for active job card (warning only)
    const [activeJobCard] = await tx
      .select({ id: jobCards.id })
      .from(jobCards)
      .where(
        and(
          eq(jobCards.vehicleId, vehicleId),
          inArray(jobCards.status, ['DRAFT', 'SHARED', 'APPROVED', 'IN_SERVICE', 'PENDING_PARTS', 'PARTS_CONFIRMED']),
        ),
      )
      .limit(1);

    const hasActiveJobCard = !!activeJobCard;

    // 6. Generate booking ref
    const bookingRef = await generateBookingRef();

    // 7. Insert appointment
    const [newAppointment] = await tx
      .insert(appointments)
      .values({
        bookingRef,
        customerId,
        vehicleId,
        // Snapshot only (Phase B2) — null when no company was selected.
        companyId: resolvedCompany?.id ?? null,
        serviceAdvisorId: body.serviceAdvisorId ?? null,
        serviceType: body.serviceType,
        complaints: body.complaints,
        estimatedDurationMinutes,
        appointmentDate: body.appointmentDate,
        appointmentTime: body.appointmentTime,
        bayId: body.bayId ?? null,
        pickupRequired: body.pickupRequired,
        pickupAddress: body.pickupAddress ?? null,
        internalNotes: body.internalNotes ?? null,
        status: 'BOOKED',
        createdBy,
      })
      .returning();

    // Sync service type to the vehicle record. If the vehicle previously
    // completed a visit (terminal status), also reset status → 'Entry (Draft)'
    // and clear entry_time so:
    //   • the gate-entry list shows the archived check-in for the prior visit
    //   • the row is "ready" to be filled in when the customer arrives
    if (vehicleId) {
      await tx
        .update(vehicles)
        .set({
          serviceType: body.serviceType,
          status: sql`CASE WHEN ${vehicles.status} IN ('Completed','Cancelled') THEN 'Entry (Draft)' ELSE ${vehicles.status} END`,
          entryTime: sql`CASE WHEN ${vehicles.status} IN ('Completed','Cancelled') THEN NULL ELSE ${vehicles.entryTime} END`,
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, vehicleId));
    }

      return { newAppointment, hasActiveJobCard };
    });

    // Send booking confirmation email non-blocking if requested
    if (body.sendEmail) {
      (async () => {
        try {
          const [cust] = await db
            .select({ firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName, email: customers.primaryEmail })
            .from(customers)
            .where(eq(customers.id, customerId!))
            .limit(1);

          if (!cust?.email) return;

          const [veh] = await db
            .select({ brand: vehicles.brand, model: vehicles.model, year: vehicles.manufacturingYear, reg: vehicles.registrationNumber })
            .from(vehicles)
            .where(eq(vehicles.id, vehicleId!))
            .limit(1);

          const vehicleInfo = veh
            ? `${veh.brand} ${veh.model} ${veh.year}${veh.reg ? ` (${veh.reg})` : ''}`
            : 'your vehicle';

          await sendAppointmentConfirmationEmail({
            customerName:    cust.companyName || `${cust.firstName} ${cust.lastName}`.trim() || 'Customer',
            customerEmail:   cust.email,
            bookingRef:      newAppointment.bookingRef,
            vehicleInfo,
            serviceType:     newAppointment.serviceType,
            appointmentDate: newAppointment.appointmentDate,
            appointmentTime: newAppointment.appointmentTime,
            complaints:      (newAppointment.complaints as string[]) ?? [],
          });

          await db
            .update(appointments)
            .set({ emailSent: true })
            .where(eq(appointments.id, newAppointment.id));
        } catch (err) {
          console.error('[Appointment] Error sending booking email:', err);
        }
      })();
    }

    // Local-first async push to Evolve for a newly-created customer only
    // (fire-and-forget after commit; dormant unless the flag is on). Phase 3.
    if (createdCustomerId) void syncCustomerToEvolve(createdCustomerId, resolvedCompany?.id).catch(() => { /* logged inside */ });

    // Resolve + persist the vehicle's Evolve ModelCode (fill-blanks-only;
    // mode-gated; inert when EVOLVE_MODELCODE_MODE=OFF). Post-commit, never blocks.
    if (vehicleId) void resolveAndPersistModelCode(vehicleId).catch(() => { /* logged inside */ });

    return created('Appointment created successfully', { ...newAppointment, hasActiveJobCard });
  } catch (err: any) {
    console.log('error :- ', err);

    // Guard failures thrown from inside the transaction — already friendly.
    if (err instanceof HttpError) {
      return error(err.httpCode, err.message);
    }

    // Postgres unique_violation → return a friendly 400 instead of a 500
    if (err?.code === '23505') {
      const constraint = err.constraint as string | undefined;
      const detail     = err.detail as string | undefined;

      const messageByConstraint: Record<string, string> = {
        uq_customer_contact_type_per_customer: 'This customer already has a contact of this type on file.',
        uq_customers_primary_email:            'A customer with this email already exists.',
        uq_vehicles_vin_active:                'A vehicle with this VIN already exists.',
        uq_vehicles_registration_number:       'A vehicle with this registration number already exists.',
        uq_vehicles_registration_active:       'A vehicle with this registration number already exists.',
        appointments_booking_ref_unique:       'Duplicate booking reference — please retry.',
      };

      const message =
        (constraint && messageByConstraint[constraint]) ||
        (detail ? `Duplicate value: ${detail}` : 'Duplicate entry — the record already exists.');

      return error(HttpStatus.BAD_REQUEST, message);
    }

    return serverError(err);
  }
}

// ─── Update Appointment Status ────────────────────────────────────────────────
export async function updateAppointmentStatus(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const { status, cancellationReason } = request.body as any;

    const [existing] = await db
      .select({ id: appointments.id, status: appointments.status })
      .from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);

    if (!existing) {
      return error(HttpStatus.NOT_FOUND, 'Appointment not found');
    }

    const updates: Record<string, any> = { status, updatedAt: new Date() };

    if (status === 'CONFIRMED') updates.confirmedAt = new Date();
    if (status === 'CANCELLED') {
      updates.cancelledAt = new Date();
      if (cancellationReason) {
        updates.internalNotes = `Cancellation reason: ${cancellationReason}`;
      }
    }

    const [updated] = await db
      .update(appointments)
      .set(updates)
      .where(eq(appointments.id, id))
      .returning();

    // Send confirmation email non-blocking when status becomes CONFIRMED
    if (status === 'CONFIRMED' && updated.customerId) {
      (async () => {
        try {
          const [cust] = await db
            .select({ firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName, email: customers.primaryEmail })
            .from(customers)
            .where(eq(customers.id, updated.customerId!))
            .limit(1);

          if (!cust?.email) return;

          let vehicleInfo = 'your vehicle';
          if (updated.vehicleId) {
            const [veh] = await db
              .select({ brand: vehicles.brand, model: vehicles.model, year: vehicles.manufacturingYear, reg: vehicles.registrationNumber })
              .from(vehicles)
              .where(eq(vehicles.id, updated.vehicleId))
              .limit(1);
            if (veh) vehicleInfo = `${veh.brand} ${veh.model} ${veh.year}${veh.reg ? ` (${veh.reg})` : ''}`;
          }

          await sendAppointmentConfirmationEmail({
            customerName:    cust.companyName || `${cust.firstName} ${cust.lastName}`.trim() || 'Customer',
            customerEmail:   cust.email,
            bookingRef:      updated.bookingRef,
            vehicleInfo,
            serviceType:     updated.serviceType,
            appointmentDate: updated.appointmentDate,
            appointmentTime: updated.appointmentTime,
            complaints:      (updated.complaints as string[]) ?? [],
          });

          await db
            .update(appointments)
            .set({ emailSent: true })
            .where(eq(appointments.id, updated.id));
        } catch (err) {
          console.error('[Appointment] Error sending confirmation email:', err);
        }
      })();
    }

    // Send cancellation email non-blocking when status becomes CANCELLED
    if (status === 'CANCELLED' && updated.customerId) {
      (async () => {
        try {
          const [cust] = await db
            .select({ firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName, email: customers.primaryEmail })
            .from(customers)
            .where(eq(customers.id, updated.customerId!))
            .limit(1);

          if (!cust?.email) return;

          let vehicleInfo = 'your vehicle';
          if (updated.vehicleId) {
            const [veh] = await db
              .select({ brand: vehicles.brand, model: vehicles.model, year: vehicles.manufacturingYear, reg: vehicles.registrationNumber })
              .from(vehicles)
              .where(eq(vehicles.id, updated.vehicleId))
              .limit(1);
            if (veh) vehicleInfo = `${veh.brand} ${veh.model} ${veh.year}${veh.reg ? ` (${veh.reg})` : ''}`;
          }

          await sendAppointmentCancellationEmail({
            customerName:       cust.companyName || `${cust.firstName} ${cust.lastName}`.trim() || 'Customer',
            customerEmail:      cust.email,
            bookingRef:         updated.bookingRef,
            vehicleInfo,
            appointmentDate:    updated.appointmentDate,
            appointmentTime:    updated.appointmentTime,
            cancellationReason: cancellationReason ?? '',
          });
        } catch (err) {
          console.error('[Appointment] Error sending cancellation email:', err);
        }
      })();
    }

    return success('Appointment status updated successfully', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Reschedule Appointment ───────────────────────────────────────────────────
const MAX_RESCHEDULES = 3;

export async function rescheduleAppointment(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    // bayId is OPTIONAL and additive: omitted → the appointment keeps whatever
    // bay it already had (previous behaviour). Supplied → the vehicle is moved
    // to that bay as part of the reschedule, validated against the new slot.
    const { newDate, newTime, reason, bayId, estimatedDurationMinutes } = request.body as {
      newDate: string; newTime: string; reason?: string; bayId?: string;
      estimatedDurationMinutes?: number;
    };

    // Validate the (optional) new duration with the SAME rule creation uses —
    // no duplicated bounds. Omitted → keep the stored duration.
    if (estimatedDurationMinutes !== undefined) {
      const durationCheck = estimatedDurationMinutesField.safeParse(estimatedDurationMinutes);
      if (!durationCheck.success) {
        return error(
          HttpStatus.BAD_REQUEST,
          durationCheck.error.issues[0]?.message ?? 'Invalid estimated duration',
          'estimatedDurationMinutes',
        );
      }
    }

    const [existing] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);

    if (!existing) {
      return error(HttpStatus.NOT_FOUND, 'Appointment not found');
    }

    if (!['BOOKED', 'CONFIRMED'].includes(existing.status)) {
      return error(HttpStatus.BAD_REQUEST, 'Only BOOKED or CONFIRMED appointments can be rescheduled.');
    }

    if (existing.rescheduleCount >= MAX_RESCHEDULES) {
      return error(
        HttpStatus.BAD_REQUEST,
        `Maximum reschedule limit (${MAX_RESCHEDULES}) reached. Please cancel and create a new appointment.`,
      );
    }

    // The duration actually in force for this reschedule: the supplied one, or
    // the stored one when none was sent. Used for BOTH the conflict check and
    // the persisted value, so the two can never disagree.
    const effectiveDuration = resolveRescheduleDuration(
      estimatedDurationMinutes,
      existing.estimatedDurationMinutes,
    );
    const durationChanged =
      estimatedDurationMinutes !== undefined &&
      estimatedDurationMinutes !== existing.estimatedDurationMinutes;

    // A bay move — or a duration change — on its own is a legitimate
    // reschedule, so only reject when NOTHING changed.
    const bayChanged = bayId !== undefined && bayId !== existing.bayId;
    if (
      existing.appointmentDate === newDate &&
      existing.appointmentTime === newTime &&
      !bayChanged &&
      !durationChanged
    ) {
      return error(
        HttpStatus.BAD_REQUEST,
        'New date, time, bay or duration must be different from the current appointment.',
      );
    }

    const today = new Date().toISOString().split('T')[0];
    if (newDate < today) {
      return error(HttpStatus.BAD_REQUEST, 'Cannot reschedule to a past date.');
    }
    if (newDate === today) {
      const now = new Date();
      const [hh, mm] = newTime.split(':').map(Number);
      const slotMinutes = hh * 60 + mm;
      const nowMinutes  = now.getHours() * 60 + now.getMinutes();
      if (slotMinutes <= nowMinutes) {
        return error(HttpStatus.BAD_REQUEST, 'Cannot reschedule to a time slot that has already passed today.');
      }
    }

    // Target bay: the newly chosen one when supplied, else whatever the
    // appointment already had (so an unchanged reschedule behaves as before).
    const targetBayId = bayId !== undefined ? bayId : existing.bayId;

    // Validate a newly chosen bay before booking into it.
    if (bayChanged && targetBayId) {
      const [bay] = await db
        .select({ id: workshopBays.id, isActive: workshopBays.isActive })
        .from(workshopBays)
        .where(eq(workshopBays.id, targetBayId))
        .limit(1);
      if (!bay) return error(HttpStatus.BAD_REQUEST, 'Selected bay not found', 'bayId');
      if (!bay.isActive) return error(HttpStatus.BAD_REQUEST, 'Selected bay is inactive', 'bayId');
    }

    // Bay-scheduled appointments re-validate the full interval on the new date/
    // time against the TARGET bay (excluding themselves), using the EFFECTIVE
    // duration — so a lengthened appointment is checked against the interval it
    // will actually occupy, not the one it used to. Capacity-slot appointments
    // keep the count check: their model is per-slot capacity and has never
    // considered duration (see assertSlotAvailable), so that is left untouched.
    if (targetBayId) {
      // NOTE: like the pre-existing date/time check, this runs outside the
      // update transaction, so two simultaneous reschedules into the same bay
      // could both pass. Unchanged from before — createAppointment takes a
      // pg_advisory_xact_lock for this, which would need the check moved inside
      // the transaction here to be effective.
      const bayError = await checkBayIntervalConflict(
        targetBayId,
        newDate,
        newTime,
        effectiveDuration,
        id,
      );
      if (bayError) return error(HttpStatus.BAD_REQUEST, bayError);
    } else {
      const slotError = await assertSlotAvailable(newDate, newTime, id);
      if (slotError) return error(HttpStatus.BAD_REQUEST, slotError);
    }

    const oldDate = existing.appointmentDate;
    const oldTime = existing.appointmentTime;
    const newCount = existing.rescheduleCount + 1;
    const userId = await resolveActorId(request);

    // appointment_reschedules has no bay columns, so a bay move is recorded in
    // the internal-notes trail alongside the date/time change (no schema change).
    let bayNote = '';
    if (bayChanged) {
      const bayNo = async (bid: string | null) => {
        if (!bid) return 'no bay';
        const [b] = await db.select({ bayNo: workshopBays.bayNo }).from(workshopBays).where(eq(workshopBays.id, bid)).limit(1);
        return b?.bayNo ?? 'unknown bay';
      };
      bayNote = `. Bay ${await bayNo(existing.bayId)} → ${await bayNo(targetBayId)}`;
    }

    // appointment_reschedules has no duration column either, so a duration
    // change is recorded in the same notes trail as the bay move.
    const durationNote = durationChanged
      ? `. Duration ${existing.estimatedDurationMinutes ?? 0} → ${effectiveDuration} min`
      : '';

    const noteEntry = `[Rescheduled ${newCount}] From ${oldDate} ${oldTime} to ${newDate} ${newTime}${bayNote}${durationNote}${reason ? `. Reason: ${reason}` : ''}`;
    const updatedNotes = existing.internalNotes
      ? `${existing.internalNotes}\n${noteEntry}`
      : noteEntry;

    const [updated] = await db.transaction(async (tx: any) => {
      await tx.insert(appointmentReschedules).values({
        appointmentId: id,
        previousDate:  oldDate,
        previousTime:  oldTime,
        newDate,
        newTime,
        reason:        reason ?? null,
        rescheduledBy: userId,
      });

      return tx
        .update(appointments)
        .set({
          appointmentDate:    newDate,
          appointmentTime:    newTime,
          // Only written when a bay was explicitly supplied — omitting bayId
          // leaves the existing bay untouched.
          ...(bayId !== undefined ? { bayId: bayId ?? null } : {}),
          // Same rule for duration: written only when supplied, and it is the
          // exact value the conflict check above validated, so the stored
          // interval can never disagree with what was verified. Sharing this
          // one .set() with date/time/bay keeps the update atomic.
          ...(estimatedDurationMinutes !== undefined
            ? { estimatedDurationMinutes: effectiveDuration }
            : {}),
          status:             'BOOKED',
          rescheduleCount:    newCount,
          lastRescheduledAt:  new Date(),
          ...(existing.rescheduleCount === 0
            ? { originalDate: oldDate, originalTime: oldTime }
            : {}),
          internalNotes:      updatedNotes,
          updatedAt:          new Date(),
        })
        .where(eq(appointments.id, id))
        .returning();
    });

    // Send reschedule email (non-blocking)
    if (updated.customerId) {
      (async () => {
        try {
          const [cust] = await db
            .select({ firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName, email: customers.primaryEmail })
            .from(customers)
            .where(eq(customers.id, updated.customerId!))
            .limit(1);

          if (!cust?.email) return;

          let vehicleInfo = 'your vehicle';
          if (updated.vehicleId) {
            const [veh] = await db
              .select({ brand: vehicles.brand, model: vehicles.model, year: vehicles.manufacturingYear, reg: vehicles.registrationNumber })
              .from(vehicles)
              .where(eq(vehicles.id, updated.vehicleId))
              .limit(1);
            if (veh) vehicleInfo = `${veh.brand} ${veh.model} ${veh.year}${veh.reg ? ` (${veh.reg})` : ''}`;
          }

          await sendAppointmentRescheduleEmail({
            customerName:    cust.companyName || `${cust.firstName} ${cust.lastName}`.trim() || 'Customer',
            customerEmail:   cust.email,
            bookingRef:      updated.bookingRef,
            vehicleInfo,
            oldDate,
            oldTime,
            newDate,
            newTime,
            rescheduleCount: newCount,
            reason:          reason ?? '',
          });
        } catch (err) {
          console.error('[Appointment] Error sending reschedule email:', err);
        }
      })();
    }

    return success('Appointment rescheduled successfully', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Appointment By Vehicle ───────────────────────────────────────────────
export async function getAppointmentByVehicle(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const today = new Date().toISOString().split('T')[0];

    const [row] = await db
      .select({
        id: appointments.id,
        bookingRef: appointments.bookingRef,
        serviceType: appointments.serviceType,
        appointmentDate: appointments.appointmentDate,
        appointmentTime: appointments.appointmentTime,
        estimatedDurationMinutes: appointments.estimatedDurationMinutes,
        status: appointments.status,
        pickupRequired: appointments.pickupRequired,
        advisorUsername: users.username,
      })
      .from(appointments)
      .leftJoin(users, eq(appointments.serviceAdvisorId, users.id))
      .where(
        and(
          eq(appointments.vehicleId, vehicleId),
          eq(appointments.appointmentDate, today),
          inArray(appointments.status, ['BOOKED', 'CONFIRMED']),
          isNull(appointments.deletedAt),
        ),
      )
      .orderBy(appointments.appointmentTime)
      .limit(1);

    return success(row ? 'Pre-booked appointment found' : 'No appointment found for today', row ?? null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Link Appointment to Check-In ────────────────────────────────────────────
export async function linkAppointmentToCheckIn(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const { checkInId } = request.body as any;

    const [appointment] = await db
      .select({ id: appointments.id, status: appointments.status })
      .from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);

    if (!appointment) {
      return error(HttpStatus.NOT_FOUND, 'Appointment not found');
    }

    const [checkIn] = await db
      .select({ id: vehicleCheckIns.id })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);

    if (!checkIn) {
      return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    }

    const [updated] = await db
      .update(appointments)
      .set({ checkInId, status: 'CHECKED_IN', updatedAt: new Date() })
      .where(eq(appointments.id, id))
      .returning();

    return success('Appointment linked to check-in successfully', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── IRM Customer Search ──────────────────────────────────────────────────────

// Convert a single Evolve lookup result into the API response shape the FE
// renders. Persists the customer to local DB and returns the new local ID.
//
// Exported for unit testing, matching the convention used by
// buildRoMaintenanceXml / gateEngineNumberForCreate. Not part of the module's
// public API — routes call irmCustomerSearch, never this directly.
export async function buildIrmSearchEntry(
  irmResult: CustomerVehicleLookupResult,
  fallbackPhone: string,
  owningCompanyId?: string | null,
) {
  const cd = irmResult.CustomerDetail ?? {};
  const vd = irmResult.Vehicles ?? {};

  const crmReferenceNo = cd.CRMReferenceNo ?? cd.CrmReferenceNo ?? '';
  const custSequenceId = cd.CustSequenceID ?? cd.CustSequenceId ?? '';

  // Persist the full Evolve payload (customer + addresses + contacts + profile
  // + AR + vehicle). Failures are logged but don't block the search response.
  let localCustomerId: string | null = null;
  try {
    const persisted = await persistEvolveCustomer(irmResult, { owningCompanyId });
    localCustomerId = persisted.customerId;
  } catch (persistErr) {
    console.log('irmCustomerSearch: persistEvolveCustomer failed :- ', persistErr);
  }

  const isCompany   = (cd.CustomerType ?? '').toUpperCase() === 'C';
  const firstName   = isCompany ? '' : (cd.FirstName ?? '');
  const lastName    = isCompany ? '' : (cd.LastName ?? '');
  const companyName = cd.CompanyName ?? '';

  const phoneCode     = cd.CellphoneCode ?? '';
  const phoneNum      = cd.CellphoneNumber ?? cd.CellphoneCodeNumber ?? '';
  const resolvedPhone = (phoneCode && phoneNum)
    ? `${phoneCode}${phoneNum}`
    : (phoneNum || phoneCode || fallbackPhone || '');

  const addrParts = [cd.PhysicalAddress1, cd.PhysicalAddress2, cd.PhysicalAddress3].filter(Boolean);
  const address   = addrParts.join(', ');

  const regNo  = vd.RegistrationNo      ?? vd.RegistrationNumber ?? '';
  const vinNo  = vd.VehVinNumber        ?? vd.VinNumber          ?? '';
  const brand  = vd.Make                ?? vd.VehicleMake        ?? vd.Brand ?? '';
  const model  = vd.Series              ?? vd.ModelDescription   ?? vd.VehicleModel ?? vd.Model ?? '';
  const year   = vd.RegistrationYear    ?? vd.ModelYear          ?? vd.VehicleYear  ?? vd.Year  ?? '';
  const fuel   = vd.FuelType            ?? vd.Fuel               ?? '';
  const trans  = vd.Transmission        ?? vd.TransmissionType   ?? '';

  const vehicle = (regNo || vinNo) ? {
    registrationNumber: regNo,
    vin:                vinNo,
    brand,
    model,
    series:             vd.Series             ?? '',
    year,
    engineNumber:       vd.EngineNumber       ?? '',
    colour:             vd.Colour             ?? '',
    fuelType:           fuel,
    transmissionType:   trans,
    modelDescription:   vd.ModelDescription   ?? '',
    registrationDate:   vd.RegistrationDate   ?? '',
    sellingDate:        vd.SellingDate        ?? '',
  } : null;

  return {
    localCustomerId,
    crmReferenceNo,
    custSequenceId,
    firstName,
    lastName,
    companyName,
    customerType:  cd.CustomerType  ?? '',
    idNumber:      cd.IDNumber       ?? '',
    // Customer identity fields the appointment contract requires but this
    // mapper previously dropped. `newCustomer.superRefine` needs regNo for a
    // company and title + initial for an individual, so an IRM-selected
    // customer that is not yet local could never produce a valid booking —
    // the client had no way to supply values Evolve already holds.
    //
    // STRICTLY from the CUSTOMER detail block. `regNo` here is the COMPANY
    // registration number (cd.RegNo); it is NOT the vehicle number plate,
    // which is the separate `regNo` local above (vd.RegistrationNo) feeding
    // vehicle.registrationNumber. The two are unrelated despite the name.
    //
    // Evolve legitimately returns a blank RegNo for many companies, so '' is
    // a real answer here and is passed through rather than substituted. The
    // response parser already trims, so a whitespace-only tag arrives as ''.
    regNo:         cd.RegNo          ?? '',
    title:         cd.Title          ?? '',
    initial:       cd.Initial        ?? '',
    phone:         resolvedPhone,
    email:         cd.PrimaryEmail   ?? '',
    address,
    city:          cd.PhysicalCity   ?? '',
    postalCode:    cd.PhysicalAreaCode ?? '',
    country:       cd.PhysicalCountry ?? '',
    vehicle,
  };
}

// Company selector → Evolve InterfaceCode. Only these codes may override the
// default env.EVOLVE_INTERFACE_CODE; anything else is ignored (falls back to env).
const ALLOWED_INTERFACE_CODES = new Set(['95112-AGLT-10EC', '95112-AGLT-20EC']);

// Single source of truth for the "owned by a different company?" decision.
// Given a vehicle's owning_company_id and the company to exclude, resolves the
// owning company via CompanyResolver (no direct companies query) and returns it
// only when it is a real, different company. Both ownership guards below (by
// VIN/reg and by vehicle id) funnel through this so the rule lives in one place.
// Returns the owning company's public CODE only (e.g. '20EC') — never the Evolve
// InterfaceCode, which must not cross the API boundary to the FE.
async function ownerCompanyIfDifferent(
  ownerCompanyId: string | null,
  excludeCompanyId: string | null,
): Promise<{ code: string } | null> {
  if (!ownerCompanyId) return null;
  if (excludeCompanyId && ownerCompanyId === excludeCompanyId) return null;
  const owner = await companyResolver.getById(ownerCompanyId);
  return owner ? { code: owner.code } : null;
}

// Cross-company ownership probe by VIN/registration (Phase 5 search + Phase D
// create). Checks whether our local mirror already knows a matching vehicle
// belongs to a DIFFERENT company. Fast, local, company-scoped.
async function findVehicleOwnerElsewhere(
  vin: string | undefined,
  reg: string | undefined,
  excludeCompanyId: string | null,
): Promise<{ code: string } | null> {
  const matchers = [];
  if (vin) matchers.push(eq(vehicles.vin, vin));
  if (reg) matchers.push(eq(vehicles.registrationNumber, reg));
  if (!matchers.length) return null;

  const [veh] = await db
    .select({ ownerId: vehicles.owningCompanyId })
    .from(vehicles)
    .where(
      and(
        isNull(vehicles.deletedAt),
        isNotNull(vehicles.owningCompanyId),
        or(...matchers),
      ),
    )
    .limit(1);

  return ownerCompanyIfDifferent(veh?.ownerId ?? null, excludeCompanyId);
}

// Cross-company ownership check by vehicle id (Phase D). Enforces "a vehicle may
// only be used within its owning company" for the existing-vehicleId path, so a
// direct API call cannot bypass the rule. Shares ownerCompanyIfDifferent.
async function findVehicleOwnerByIdElsewhere(
  vehicleId: string,
  excludeCompanyId: string | null,
): Promise<{ code: string } | null> {
  const [veh] = await db
    .select({ ownerId: vehicles.owningCompanyId })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.deletedAt)))
    .limit(1);

  return ownerCompanyIfDifferent(veh?.ownerId ?? null, excludeCompanyId);
}

export async function irmCustomerSearch(request: FastifyRequest) {
  try {
    const { phone, reg, vin, interfaceCode, companyId } = request.query as any;

    // Company resolution — single authority via CompanyResolver.
    // Prefer companyId (the target contract): resolve + validate active here so
    // the FE never handles InterfaceCode. Fall back to the legacy interfaceCode
    // query param (whitelisted) for backward compatibility with older clients.
    let resolvedInterfaceCode: string | undefined;
    let resolvedCompanyId: string | null = null;
    // Public company CODE (e.g. '10EC') for the response meta — the InterfaceCode
    // is resolved/used server-side only and never returned to the FE (M1).
    let resolvedCompanyCode: string | null = null;
    if (companyId) {
      const company = await companyResolver.getById(companyId);
      if (!company || !company.isActive) {
        return error(HttpStatus.BAD_REQUEST, 'Invalid or inactive company', 'companyId');
      }
      resolvedInterfaceCode = company.interfaceCode;
      resolvedCompanyId = company.id;
      resolvedCompanyCode = company.code;
      // Log the company identity only — never the InterfaceCode.
      console.log(`[irm-search] company resolved: companyId=${company.id} companyCode=${company.code}`);
    } else if (ALLOWED_INTERFACE_CODES.has(interfaceCode)) {
      resolvedInterfaceCode = interfaceCode as string;
    }

    // Resolve the search into a typed outcome (Phase 1). Response `data` stays
    // an array in every case; the outcome travels in the additive `meta` sibling.
    let combined: IrmSearchResult;
    try {
      // Phone searches try BOTH canonical forms so customers this app writes
      // (27-prefixed) AND pre-existing native Evolve records (0/area-code) are
      // found — no regression from the phone-format change. reg/vin searches
      // carry no phone → a single pass with an empty phone (unchanged behaviour).
      const phoneForms = phone ? phoneSearchCandidates(phone) : [''];
      let anyUnavailable = false;
      combined = { outcome: 'NOT_FOUND', results: [] };

      for (const pf of phoneForms) {
        // Primary: vehicle-anchored lookup (returns customer + vehicle data).
        const primary = await lookupCustomers({ phone: pf, reg, vin, interfaceCode: resolvedInterfaceCode });
        let res: IrmSearchResult = primary;

        if (primary.outcome !== 'FOUND') {
          // Fallback: a customer we synced to Evolve (via CustomerMaintenance) has
          // NO vehicle there, so the vehicle-anchored lookup can't find it. Retry
          // with the customer-only lookup so synced / vehicle-less customers are
          // still findable (by phone).
          const fallback = await lookupCustomersOnly({ phone: pf, reg, vin, interfaceCode: resolvedInterfaceCode });
          if (fallback.outcome === 'FOUND') {
            res = fallback;
          } else if (primary.outcome === 'UNAVAILABLE' || fallback.outcome === 'UNAVAILABLE') {
            anyUnavailable = true;
          }
        }

        if (res.outcome === 'FOUND') { combined = res; break; }
      }

      // Nothing FOUND across candidates, but a call couldn't answer → not authoritative.
      if (combined.outcome !== 'FOUND' && anyUnavailable) {
        combined = { outcome: 'UNAVAILABLE', results: [] };
      }
    } catch (err: any) {
      // Unexpected (non-transport) error — degrade to UNAVAILABLE, never a false NOT_FOUND.
      console.error('[IRM] irmCustomerSearch lookup threw:', err?.message ?? err);
      combined = { outcome: 'UNAVAILABLE', results: [] };
    }

    // Resolve the selected company once — used to stamp ownership on FOUND
    // (Phase 4) and to exclude "self" from the cross-company probe (Phase 5).
    // Best-effort: if the registry isn't seeded / no company selected, null.
    // companyId path already knows the id; only the legacy interfaceCode path
    // needs the reverse lookup — routed through CompanyResolver, not a direct query.
    let selectedCompanyId: string | null = resolvedCompanyId;
    let selectedCompanyCode: string | null = resolvedCompanyCode;
    if (!selectedCompanyId && resolvedInterfaceCode) {
      const co = await companyResolver.getByInterfaceCode(resolvedInterfaceCode);
      selectedCompanyId = co?.id ?? null;
      selectedCompanyCode = co?.code ?? null;
    }

    const isVehicleSearch = !!(vin || reg);

    // FOUND → persist (tagged with the owning company) + return entries.
    if (combined.outcome === 'FOUND') {
      const entries = await Promise.all(
        combined.results.map((r) => buildIrmSearchEntry(r, phone ?? '', selectedCompanyId)),
      );
      return successWithMeta('IRM search completed', entries, {
        outcome: 'FOUND',
        company: selectedCompanyCode,
        source: 'evolve',
      });
    }

    // NOT_FOUND on a vehicle search → is this VIN/reg owned by ANOTHER company
    // in our local mirror? If so, tell the FE to offer a company switch.
    if (combined.outcome === 'NOT_FOUND' && isVehicleSearch) {
      const owner = await findVehicleOwnerElsewhere(vin, reg, selectedCompanyId);
      if (owner) {
        return successWithMeta('IRM search completed', [], {
          outcome: 'SWITCH_COMPANY',
          company: selectedCompanyCode,
          source: 'local',
          ownedByCompany: { code: owner.code },
        });
      }
    }

    // NOT_FOUND (nowhere else) or UNAVAILABLE → return the outcome unchanged.
    return successWithMeta('IRM search completed', [], {
      outcome: combined.outcome,
      company: selectedCompanyCode,
      source: 'evolve',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Today's Appointments (Gate Entry quick-pick) ────────────────────────────
// Returns today's BOOKED/CONFIRMED/CHECKED_IN appointments with vehicle +
// customer + active-check-in detection so the security dashboard can show a
// pick-list instead of forcing gatekeepers to type VIN/reg manually.
export async function listTodaysAppointmentsForGate(_request: FastifyRequest) {
  try {
    const today = new Date().toISOString().split('T')[0];

    const rows = await db
      .select({
        id: appointments.id,
        bookingRef: appointments.bookingRef,
        appointmentTime: appointments.appointmentTime,
        serviceType: appointments.serviceType,
        status: appointments.status,
        estimatedDurationMinutes: appointments.estimatedDurationMinutes,
        vehicleId: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        vin: vehicles.vin,
        brand: vehicles.brand,
        model: vehicles.model,
        manufacturingYear: vehicles.manufacturingYear,
        customerId: customers.id,
        customerCompanyName: customers.companyName,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerPhone: sql<string>`(
          SELECT cc.contact_number FROM customer_contacts cc
          WHERE cc.customer_id = ${appointments.customerId}
            AND cc.contact_type = 'MOBILE'
          LIMIT 1
        )`,
        activeCheckInId: sql<string | null>`(
          SELECT vci.id FROM vehicle_check_ins vci
          WHERE vci.vehicle_id = ${appointments.vehicleId}
            AND vci.is_active = true
          LIMIT 1
        )`,
      })
      .from(appointments)
      .leftJoin(vehicles, eq(appointments.vehicleId, vehicles.id))
      .leftJoin(customers, eq(appointments.customerId, customers.id))
      .where(and(
        eq(appointments.appointmentDate, today),
        isNull(appointments.deletedAt),
        // Skip cancelled / completed — they shouldn't show in the gate queue.
        sql`${appointments.status} NOT IN ('CANCELLED', 'COMPLETED')`,
      ))
      .orderBy(asc(appointments.appointmentTime));

    const data = rows.map((r) => ({
      id: r.id,
      bookingRef: r.bookingRef,
      appointmentTime: r.appointmentTime,
      serviceType: r.serviceType,
      status: r.status,
      estimatedDurationMinutes: r.estimatedDurationMinutes,
      vehicleId: r.vehicleId,
      registrationNumber: r.registrationNumber,
      vin: r.vin,
      brand: r.brand,
      model: r.model,
      manufacturingYear: r.manufacturingYear,
      customerId: r.customerId,
      customerName:
        r.customerCompanyName ||
        `${r.customerFirstName ?? ''} ${r.customerLastName ?? ''}`.trim() ||
        null,
      customerPhone: r.customerPhone,
      hasActiveCheckIn: !!r.activeCheckInId,
    }));

    return success('OK', data);
  } catch (err) {
    return serverError(err);
  }
}
