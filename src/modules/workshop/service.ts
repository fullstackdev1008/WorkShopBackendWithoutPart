import { FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  workshopBays,
  workshopAllocations,
  vehicleCheckIns,
  vehicles,
  customers,
  users,
  jobCards,
  jobCardItems,
  appointments,
} from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { setRoStatus } from '../../shared/utils/roStatus';
import { resolveUserScope, shopFilter, checkInInScope } from '../../shared/security/scope';
// DORMANT Job Card → Evolve sync. No-op while EVOLVE_JOB_CARD_SYNC_ENABLED=false.
import { syncJobCardUpdateToEvolve } from '../../services/jobCardEvolveSync.service';

// ─── Bay CRUD ──────────────────────────────────────────────────────────────

export async function listBays(request: FastifyRequest) {
  try {
    // Optional ?category=SERVICE|MAJOR|PDI filter so the allocation screen can
    // request only the bays of the category the foreman selected.
    const q = (request.query ?? {}) as { category?: string };
    const validCategories = ['SERVICE', 'MAJOR', 'PDI'] as const;
    const category = validCategories.includes(q.category as any)
      ? (q.category as (typeof validCategories)[number])
      : undefined;

    const rows = await db
      .select({
        id: workshopBays.id,
        bayNo: workshopBays.bayNo,
        category: workshopBays.category,
        location: workshopBays.location,
        capabilities: workshopBays.capabilities,
        isActive: workshopBays.isActive,
        currentAllocationId: workshopBays.currentAllocationId,
      })
      .from(workshopBays)
      .where(category ? eq(workshopBays.category, category) : undefined)
      .orderBy(asc(workshopBays.bayNo));

    // Attach occupant info (which check-in / which vehicle) for occupied bays.
    const occupiedIds = rows.filter((r) => r.currentAllocationId).map((r) => r.currentAllocationId!) as string[];
    type OccupantRow = {
      allocationId: string;
      checkInId: string;
      vehicleReg: string | null;
      vehicleBrand: string;
      vehicleModel: string;
      priority: string;
      repairCategory: string;
      allocatedAt: Date;
    };
    const occupantsByAlloc = new Map<string, OccupantRow>();
    if (occupiedIds.length > 0) {
      const occRows = await db
        .select({
          allocationId: workshopAllocations.id,
          checkInId: workshopAllocations.checkInId,
          vehicleReg: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          priority: workshopAllocations.priority,
          repairCategory: workshopAllocations.repairCategory,
          allocatedAt: workshopAllocations.allocatedAt,
        })
        .from(workshopAllocations)
        .innerJoin(vehicleCheckIns, eq(vehicleCheckIns.id, workshopAllocations.checkInId))
        .innerJoin(vehicles, eq(vehicles.id, vehicleCheckIns.vehicleId))
        .where(inArray(workshopAllocations.id, occupiedIds));
      occRows.forEach((o) => occupantsByAlloc.set(o.allocationId, o as OccupantRow));
    }

    // Today's appointment bay reservations (Bay & Time-Slot scheduling) so the
    // foreman can see which bays are pre-booked by appointments even before the
    // vehicle physically arrives / is allocated. Separate from live occupancy.
    const today = new Date().toISOString().split('T')[0];
    const bayIds = rows.map((r) => r.id);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const addMinutes = (hhmm: string, mins: number) => {
      const [h, m] = hhmm.split(':').map(Number);
      const total = h * 60 + m + mins;
      return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
    };
    type Reservation = { appointmentId: string; time: string; endTime: string; vehicleReg: string | null; bookingRef: string };
    const reservationsByBay = new Map<string, Reservation[]>();
    if (bayIds.length > 0) {
      const resRows = await db
        .select({
          appointmentId: appointments.id,
          bayId: appointments.bayId,
          time: appointments.appointmentTime,
          duration: appointments.estimatedDurationMinutes,
          vehicleReg: vehicles.registrationNumber,
          bookingRef: appointments.bookingRef,
        })
        .from(appointments)
        .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
        .where(
          and(
            eq(appointments.appointmentDate, today),
            inArray(appointments.status, ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE']),
            // A reservation is only meaningful until the vehicle has actually
            // been put in a bay. Nothing moves an appointment past CHECKED_IN,
            // so after the foreman signed off — allocation released, but the
            // appointment still CHECKED_IN — the bay flipped from "Occupied"
            // back to "Reserved" for a visit that had just finished.
            //
            // Keyed on whether this check-in has EVER held an allocation, not
            // on appointment status: a vehicle that has arrived but is still
            // awaiting allocation must keep showing its reserved bay, or the
            // foreman could put someone else in it.
            sql`NOT EXISTS (
              SELECT 1 FROM workshop_allocations wa
              WHERE wa.check_in_id = ${appointments.checkInId}
            )`,
            isNull(appointments.deletedAt),
            inArray(appointments.bayId, bayIds),
          ),
        )
        .orderBy(asc(appointments.appointmentTime));
      for (const r of resRows) {
        if (!r.bayId) continue;
        const list = reservationsByBay.get(r.bayId) ?? [];
        list.push({
          appointmentId: r.appointmentId,
          time: r.time,
          endTime: addMinutes(r.time, r.duration ?? 0),
          vehicleReg: r.vehicleReg ?? null,
          bookingRef: r.bookingRef,
        });
        reservationsByBay.set(r.bayId, list);
      }
    }

    const data = rows.map((r) => ({
      ...r,
      occupant: r.currentAllocationId ? occupantsByAlloc.get(r.currentAllocationId) ?? null : null,
      reservations: reservationsByBay.get(r.id) ?? [],
    }));

    return success('Bays fetched successfully', data);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function createBay(request: FastifyRequest) {
  try {
    const body = request.body as {
      bayNo: string;
      category?: 'SERVICE' | 'MAJOR' | 'PDI' | null;
      location?: string;
      capabilities?: string[];
      isActive?: boolean;
    };
    if (!body.bayNo?.trim()) {
      return error(HttpStatus.BAD_REQUEST, 'Bay number is required');
    }
    const [row] = await db
      .insert(workshopBays)
      .values({
        bayNo: body.bayNo.trim(),
        category: body.category ?? null,
        location: body.location?.trim() || null,
        capabilities: body.capabilities ?? [],
        isActive: body.isActive ?? true,
      })
      .returning();
    return created('Bay created', row);
  } catch (err: any) {
    console.log('error :- ', err);
    if (err?.code === '23505') {
      return error(HttpStatus.BAD_REQUEST, 'A bay with that number already exists');
    }
    return serverError(err);
  }
}

export async function updateBay(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as Partial<{
      bayNo: string;
      category: 'SERVICE' | 'MAJOR' | 'PDI' | null;
      location: string | null;
      capabilities: string[];
      isActive: boolean;
    }>;
    const [row] = await db
      .update(workshopBays)
      .set({
        ...(body.bayNo !== undefined && { bayNo: body.bayNo.trim() }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.location !== undefined && { location: body.location?.trim() || null }),
        ...(body.capabilities !== undefined && { capabilities: body.capabilities }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(workshopBays.id, id))
      .returning();
    if (!row) return error(HttpStatus.NOT_FOUND, 'Bay not found');
    return success('Bay updated', row);
  } catch (err: any) {
    console.log('error :- ', err);
    if (err?.code === '23505') {
      return error(HttpStatus.BAD_REQUEST, 'A bay with that number already exists');
    }
    return serverError(err);
  }
}

export async function deleteBay(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const [bay] = await db
      .select({ id: workshopBays.id, currentAllocationId: workshopBays.currentAllocationId })
      .from(workshopBays)
      .where(eq(workshopBays.id, id))
      .limit(1);
    if (!bay) return error(HttpStatus.NOT_FOUND, 'Bay not found');
    if (bay.currentAllocationId) {
      return error(HttpStatus.CONFLICT, 'Cannot delete a bay that is currently occupied');
    }
    await db.delete(workshopBays).where(eq(workshopBays.id, id));
    return success('Bay deleted', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Foreman Dashboard ─────────────────────────────────────────────────────

// Vehicles whose ro_status is QC_CHECK_IN (or earlier) — i.e. QC is done
// and they are awaiting bay allocation. Plus vehicles already IN_WORKSHOP
// or DIAGNOSING so the foreman can see what's on the floor.
export async function getDashboard(request: FastifyRequest) {
  try {
    const q = (request.query ?? {}) as { page?: string | number; limit?: string | number; tab?: string };
    const paginated = q.page != null || q.limit != null;
    const tabMap: Record<string, string[]> = {
      awaiting: ['ARRIVED', 'QC_CHECK_IN'],
      inWorkshop: ['IN_WORKSHOP', 'DIAGNOSING'],
      rework: ['QC_FAILED'],
    };
    const allowedStatuses = ['ARRIVED', 'QC_CHECK_IN', 'IN_WORKSHOP', 'DIAGNOSING', 'QC_FAILED'];

    // Shop scoping (on top of WORKSHOP:view). undefined for super-admin / ALL.
    const scope = await resolveUserScope(request);

    const rows = await db
      .select({
        checkInId: vehicleCheckIns.id,
        roStatus: vehicleCheckIns.roStatus,
        vehicleId: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        receivingNo: vehicleCheckIns.receivingNo,
        complaintText: vehicleCheckIns.complaintText,
        damagesNotes: vehicleCheckIns.damagesNotes,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        checkInTime: vehicleCheckIns.checkInTime,
      })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicles.id, vehicleCheckIns.vehicleId))
      .leftJoin(customers, eq(customers.id, vehicles.customerId))
      .where(
        // Pull every active check-in. Tab/filter logic below decides
        // membership using ro_status + needsReallocation. Filtering at
        // SQL level by ro_status missed cases like QC_OUT where a NEW
        // job card was created after the first job's bay was released.
        // shopFilter() narrows to the foreman's shop (no-op for ALL/super-admin).
        and(eq(vehicleCheckIns.isActive, true), shopFilter(scope)),
      )
      .orderBy(desc(vehicleCheckIns.checkInTime));

    // Pull any open allocation per check-in so the "In Workshop" tab shows
    // the bay + priority + category.
    const checkInIds = rows.map((r) => r.checkInId);
    const allocs = checkInIds.length === 0 ? [] : await db
      .select({
        checkInId: workshopAllocations.checkInId,
        bayId: workshopAllocations.bayId,
        bayNo: workshopBays.bayNo,
        bayCategory: workshopBays.category,
        priority: workshopAllocations.priority,
        repairCategory: workshopAllocations.repairCategory,
        notes: workshopAllocations.notes,
        allocatedAt: workshopAllocations.allocatedAt,
        allocatedBy: workshopAllocations.allocatedBy,
        allocatedByName: users.username,
      })
      .from(workshopAllocations)
      .innerJoin(workshopBays, eq(workshopBays.id, workshopAllocations.bayId))
      .leftJoin(users, eq(users.id, workshopAllocations.allocatedBy))
      .where(
        and(
          inArray(workshopAllocations.checkInId, checkInIds),
          isNull(workshopAllocations.releasedAt),
        ),
      );
    const allocByCheckIn = new Map(allocs.map((a) => [a.checkInId, a]));

    // Bay RESERVED by an appointment (Bay & Time-Slot scheduling), keyed by the
    // check-in the appointment was converted into. Lets the "Awaiting
    // Allocation" card show which bay is already held for the vehicle and who
    // booked it — the same bay/actor context the "In Workshop" tab gets from
    // an allocation. Distinct from `allocation`: nothing is on the floor yet.
    const reservations = checkInIds.length === 0 ? [] : await db
      .select({
        checkInId: appointments.checkInId,
        bayId: appointments.bayId,
        bayNo: workshopBays.bayNo,
        bayCategory: workshopBays.category,
        appointmentId: appointments.id,
        bookingRef: appointments.bookingRef,
        time: appointments.appointmentTime,
        reservedBy: appointments.createdBy,
        reservedByName: users.username,
      })
      .from(appointments)
      .innerJoin(workshopBays, eq(workshopBays.id, appointments.bayId))
      .leftJoin(users, eq(users.id, appointments.createdBy))
      .where(
        and(
          inArray(appointments.checkInId, checkInIds),
          inArray(appointments.status, ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] as any),
          isNull(appointments.deletedAt),
        ),
      )
      .orderBy(asc(appointments.appointmentTime));
    // First (earliest) reservation wins if a check-in somehow has several.
    const reservationByCheckIn = new Map<string, (typeof reservations)[number]>();
    for (const r of reservations) {
      if (r.checkInId && !reservationByCheckIn.has(r.checkInId)) {
        reservationByCheckIn.set(r.checkInId, r);
      }
    }

    // Detect "needs reallocation" — check-ins that have an actionable job
    // card (APPROVED / IN_PROGRESS / PARTS_CONFIRMED) but no active bay.
    // Happens when SA creates a new job card on a vehicle whose previous
    // bay was already released after a prior job finished. Without this,
    // the foreman dashboard wouldn't surface these vehicles and the
    // technician would be stuck on "Waiting for bay allocation".
    const needsBayCheckInIds = checkInIds.length === 0 ? [] : await db
      .select({ checkInId: jobCards.vehicleCheckInId, jobCardId: jobCards.id })
      .from(jobCards)
      .where(
        and(
          inArray(jobCards.vehicleCheckInId, checkInIds),
          inArray(jobCards.status, ['APPROVED', 'PARTS_CONFIRMED', 'IN_PROGRESS', 'IN_SERVICE'] as any),
        ),
      );
    const needsBaySet = new Set(needsBayCheckInIds.map((r) => r.checkInId).filter(Boolean) as string[]);
    // Map check-in → its actionable job card, so the Foreman UI can deep-link
    // into the job card detail to allocate technicians.
    const jobCardByCheckIn = new Map<string, string>();
    for (const r of needsBayCheckInIds) {
      if (r.checkInId && !jobCardByCheckIn.has(r.checkInId)) jobCardByCheckIn.set(r.checkInId, r.jobCardId);
    }

    const data = rows.map((r) => {
      const alloc = allocByCheckIn.get(r.checkInId) ?? null;
      const needsBay = !alloc && needsBaySet.has(r.checkInId);
      return {
        ...r,
        customerName: `${r.customerFirstName ?? ''} ${r.customerLastName ?? ''}`.trim() || null,
        allocation: alloc,
        // Only surface the reservation while no live allocation exists — once
        // the bay is actually allocated, `allocation` is the truth.
        reservation: alloc ? null : reservationByCheckIn.get(r.checkInId) ?? null,
        needsReallocation: needsBay,
        jobCardId: jobCardByCheckIn.get(r.checkInId) ?? null,
      };
    });

    // Counts for the dashboard header (across all rows, not filtered).
    const stats = {
      awaiting: data.filter((d) =>
        d.roStatus === 'ARRIVED' || d.roStatus === 'QC_CHECK_IN' || d.needsReallocation
      ).length,
      inWorkshop: data.filter((d) =>
        (d.roStatus === 'IN_WORKSHOP' || d.roStatus === 'DIAGNOSING') && !d.needsReallocation
      ).length,
    };

    if (!paginated) {
      // Without pagination, only return rows the dashboard actually cares
      // about — the allowed statuses plus any check-in flagged for
      // re-allocation. Stops the response from leaking unrelated rows
      // (e.g. QC_OUT vehicles still awaiting gate release).
      const items = data.filter(
        (d) => allowedStatuses.includes(d.roStatus as string) || d.needsReallocation,
      );
      return success('Foreman dashboard fetched', { items, stats });
    }

    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;
    const statuses = (q.tab && tabMap[q.tab]) ? tabMap[q.tab] : allowedStatuses;
    const filtered = data.filter((d) => {
      // "awaiting" tab also includes vehicles whose prior bay was released
      // and now need a new allocation for a freshly-created job card.
      if (q.tab === 'awaiting' && d.needsReallocation) return true;
      // Conversely, in-workshop should exclude rows that need re-allocation
      // — they appear under awaiting instead.
      if (q.tab === 'inWorkshop' && d.needsReallocation) return false;
      return statuses.includes(d.roStatus as string);
    });
    const total = filtered.length;
    const pagedItems = filtered.slice(offset, offset + limit);

    return success('Foreman dashboard fetched', {
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

// ─── Allocate / Re-allocate / Release ──────────────────────────────────────

// Keep the appointment's reserved bay in sync with the foreman's physical bay
// decision. When the foreman allocates / re-allocates a check-in to a bay, the
// linked appointment reservation (appointments.bay_id) follows — so the old bay
// frees on the Bay Occupancy strip and the two models don't diverge.
// Best-effort: a failure here never blocks the allocation.
async function syncAppointmentBay(checkInId: string, bayId: string) {
  try {
    await db
      .update(appointments)
      .set({ bayId, updatedAt: new Date() })
      .where(
        and(
          eq(appointments.checkInId, checkInId),
          isNull(appointments.deletedAt),
          inArray(appointments.status, ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE']),
        ),
      );
  } catch (e) {
    console.log('[syncAppointmentBay] failed:', (e as Error)?.message);
  }
}

export async function allocateToBay(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    const body = request.body as {
      bayId: string;
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      repairCategory: 'ENGINE' | 'TRANSMISSION' | 'ELECTRICAL' | 'BRAKES' | 'BODY' | 'AC' | 'OTHER';
      notes?: string;
      // Rework loop — when the vehicle is at QC_FAILED, the foreman picks a
      // technician for each failed work item. Each entry reopens the item
      // (clears completedAt), updates assignedTechnicianId, and stores the
      // brief in rework_notes for the tech to read.
      reworkAssignments?: Array<{
        jobCardItemId: string;
        technicianId: string;
        reworkNotes?: string;
      }>;
    };

    if (!body?.bayId) return error(HttpStatus.BAD_REQUEST, 'bayId is required');
    const actorId = await resolveActorId(request);
    const scope = await resolveUserScope(request);

    // Validate the check-in exists and isn't already allocated to ANOTHER bay.
    const [checkIn] = await db
      .select({ id: vehicleCheckIns.id, roStatus: vehicleCheckIns.roStatus, shop: vehicleCheckIns.shop })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);
    if (!checkIn) return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    // Shop scope (IDOR guard): a scoped foreman can only allocate jobs in their shop.
    if (!checkInInScope(scope, checkIn.shop)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const isRework = checkIn.roStatus === 'QC_FAILED';
    const reworkAssignments = body.reworkAssignments ?? [];
    if (isRework && reworkAssignments.length === 0) {
      return error(
        HttpStatus.BAD_REQUEST,
        'Rework requires at least one technician assignment.',
      );
    }

    const [existingOpen] = await db
      .select({ id: workshopAllocations.id, bayId: workshopAllocations.bayId })
      .from(workshopAllocations)
      .where(and(eq(workshopAllocations.checkInId, checkInId), isNull(workshopAllocations.releasedAt)))
      .limit(1);
    if (existingOpen) {
      return error(
        HttpStatus.CONFLICT,
        'This check-in already has an active allocation. Use re-allocate to move it to a different bay.',
      );
    }

    // Bay must exist and be active + free.
    const [bay] = await db
      .select({ id: workshopBays.id, bayNo: workshopBays.bayNo, isActive: workshopBays.isActive, currentAllocationId: workshopBays.currentAllocationId })
      .from(workshopBays)
      .where(eq(workshopBays.id, body.bayId))
      .limit(1);
    if (!bay) return error(HttpStatus.NOT_FOUND, 'Bay not found');
    if (!bay.isActive) return error(HttpStatus.BAD_REQUEST, 'Bay is inactive');
    if (bay.currentAllocationId) {
      return error(HttpStatus.CONFLICT, 'Bay is already occupied');
    }

    const now = new Date();
    const [alloc] = await db.transaction(async (tx: any) => {
      const inserted = await tx
        .insert(workshopAllocations)
        .values({
          checkInId,
          bayId: body.bayId,
          priority: body.priority,
          repairCategory: body.repairCategory,
          notes: body.notes?.trim() || null,
          allocatedBy: actorId,
          allocatedAt: now,
        })
        .returning();
      await tx
        .update(workshopBays)
        .set({ currentAllocationId: inserted[0].id, updatedAt: now })
        .where(eq(workshopBays.id, body.bayId));

      // Rework path: reopen each failed item, reassign tech, write brief.
      // Also reset the parent job card if it had auto-completed last round.
      if (isRework && reworkAssignments.length > 0) {
        const jobCardsTouched = new Set<string>();
        for (const ra of reworkAssignments) {
          const [item] = await tx
            .select({ id: jobCardItems.id, jobCardId: jobCardItems.jobCardId, reworkCount: jobCardItems.reworkCount })
            .from(jobCardItems)
            .where(eq(jobCardItems.id, ra.jobCardItemId))
            .limit(1);
          if (!item) continue;
          await tx
            .update(jobCardItems)
            .set({
              completedAt: null,
              completedBy: null,
              completionNotes: null,
              assignedTechnicianId: ra.technicianId,
              assignedAt: now,
              assignedBy: actorId,
              reworkNotes: ra.reworkNotes?.trim() || null,
              reworkCount: (item.reworkCount ?? 0) + 1,
              updatedAt: now,
            })
            .where(eq(jobCardItems.id, ra.jobCardItemId));
          jobCardsTouched.add(item.jobCardId);
        }
        // Flip touched job cards back to IN_PROGRESS so the rest of the
        // pipeline (Phase 3 auto-fire of QC_OUT on full completion, SA
        // visibility, etc.) treats them as live again.
        for (const jcId of jobCardsTouched) {
          await tx
            .update(jobCards)
            .set({ status: 'IN_PROGRESS', updatedAt: now, updatedBy: actorId })
            .where(eq(jobCards.id, jcId));
        }
      }
      return inserted;
    });

    // Move RO status to IN_WORKSHOP. setRoStatus is idempotent and writes
    // the audit row + dispatches Phase 4 notifications.
    await setRoStatus(
      checkInId,
      'IN_WORKSHOP',
      actorId,
      isRework
        ? `Rework allocated to ${bay.bayNo} (${reworkAssignments.length} item${reworkAssignments.length === 1 ? '' : 's'})`
        : `Allocated to ${bay.bayNo}`,
    );

    // Sync the linked appointment reservation to this bay (see helper above).
    await syncAppointmentBay(checkInId, body.bayId);

    return created(isRework ? 'Rework allocated' : 'Allocated to bay', alloc);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function reallocate(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    const body = request.body as {
      bayId: string;
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      repairCategory: 'ENGINE' | 'TRANSMISSION' | 'ELECTRICAL' | 'BRAKES' | 'BODY' | 'AC' | 'OTHER';
      notes?: string;
    };
    const actorId = await resolveActorId(request);
    const scope = await resolveUserScope(request);

    // Shop scope (IDOR guard) — verify the check-in belongs to the foreman's shop.
    const [reallocCheckIn] = await db
      .select({ shop: vehicleCheckIns.shop })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);
    if (!reallocCheckIn) return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    if (!checkInInScope(scope, reallocCheckIn.shop)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const [currentAlloc] = await db
      .select({ id: workshopAllocations.id, bayId: workshopAllocations.bayId })
      .from(workshopAllocations)
      .where(and(eq(workshopAllocations.checkInId, checkInId), isNull(workshopAllocations.releasedAt)))
      .limit(1);
    if (!currentAlloc) return error(HttpStatus.NOT_FOUND, 'No active allocation to re-allocate');

    const [newBay] = await db
      .select({ id: workshopBays.id, isActive: workshopBays.isActive, currentAllocationId: workshopBays.currentAllocationId })
      .from(workshopBays)
      .where(eq(workshopBays.id, body.bayId))
      .limit(1);
    if (!newBay) return error(HttpStatus.NOT_FOUND, 'Target bay not found');
    if (!newBay.isActive) return error(HttpStatus.BAD_REQUEST, 'Target bay is inactive');
    if (newBay.currentAllocationId && newBay.currentAllocationId !== currentAlloc.id) {
      return error(HttpStatus.CONFLICT, 'Target bay is already occupied');
    }

    const now = new Date();
    const [created_] = await db.transaction(async (tx: any) => {
      // Close the old allocation FIRST so there is never more than one open
      // allocation per check-in at any instant. The partial unique index
      // (uq_allocation_open_per_checkin, WHERE released_at IS NULL) is checked
      // per-statement, so inserting the new row while the old is still open
      // would violate it (23505). Free the old bay in the same step.
      await tx
        .update(workshopAllocations)
        .set({ releasedAt: now })
        .where(eq(workshopAllocations.id, currentAlloc.id));
      await tx
        .update(workshopBays)
        .set({ currentAllocationId: null, updatedAt: now })
        .where(eq(workshopBays.id, currentAlloc.bayId));
      // Now insert the new (only) open allocation.
      const inserted = await tx
        .insert(workshopAllocations)
        .values({
          checkInId,
          bayId: body.bayId,
          priority: body.priority,
          repairCategory: body.repairCategory,
          notes: body.notes?.trim() || null,
          allocatedBy: actorId,
          allocatedAt: now,
        })
        .returning();
      // Link the closed allocation forward to the new one.
      await tx
        .update(workshopAllocations)
        .set({ supersededBy: inserted[0].id })
        .where(eq(workshopAllocations.id, currentAlloc.id));
      // Mark the new bay occupied.
      await tx
        .update(workshopBays)
        .set({ currentAllocationId: inserted[0].id, updatedAt: now })
        .where(eq(workshopBays.id, body.bayId));
      return inserted;
    });

    // Sync the linked appointment reservation to the new bay (see helper above).
    await syncAppointmentBay(checkInId, body.bayId);

    return success('Re-allocated to new bay', created_);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Internal helper called from setRoStatus and re-entry. Idempotent: a no-op
// when there's no active allocation for the given check-in.
export async function releaseAllocationForCheckIn(checkInId: string) {
  const now = new Date();
  const [open] = await db
    .select({ id: workshopAllocations.id, bayId: workshopAllocations.bayId })
    .from(workshopAllocations)
    .where(and(eq(workshopAllocations.checkInId, checkInId), isNull(workshopAllocations.releasedAt)))
    .limit(1);
  if (!open) return;
  await db.transaction(async (tx: any) => {
    await tx
      .update(workshopAllocations)
      .set({ releasedAt: now })
      .where(eq(workshopAllocations.id, open.id));
    await tx
      .update(workshopBays)
      .set({ currentAllocationId: null, updatedAt: now })
      .where(eq(workshopBays.id, open.bayId));
  });
}

// Manual release endpoint (used rarely — most releases happen automatically).
// Note: the internal releaseAllocationForCheckIn() helper stays unscoped — it
// is called by system flows (setRoStatus, re-entry), not by a scoped actor.
export async function releaseAllocation(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    const scope = await resolveUserScope(request);

    // Shop scope (IDOR guard) before the manual release.
    const [relCheckIn] = await db
      .select({ shop: vehicleCheckIns.shop })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);
    if (!relCheckIn) return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    if (!checkInInScope(scope, relCheckIn.shop)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    await releaseAllocationForCheckIn(checkInId);
    return success('Allocation released', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Unused-import shim — keeps sql in scope for future raw queries; the linter
// complains otherwise.
const _ = sql;
void _;

// ─── Foreman Sign-Off / Reject (Phase 7) ─────────────────────────────────────
// After every item on a job card is marked complete by the technician, the
// card lands in FOREMAN_REVIEW. The foreman either signs off (→ COMPLETED,
// eligible for QC Out) or rejects with a reason (→ IN_PROGRESS so the tech
// can rework).

export async function signOffJobCard(request: FastifyRequest) {
  try {
    const { jobCardId } = request.params as any;
    const body = (request.body ?? {}) as { signatureUrl?: string };
    const signatureUrl = (body.signatureUrl ?? '').trim();
    if (!signatureUrl) {
      return error(HttpStatus.BAD_REQUEST, 'Foreman signature is required to sign off.');
    }

    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    const scope = await resolveUserScope(request);

    const [jc] = await db
      .select({ id: jobCards.id, status: jobCards.status, checkInShop: vehicleCheckIns.shop })
      .from(jobCards)
      .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
      .where(eq(jobCards.id, jobCardId))
      .limit(1);
    if (!jc) return error(HttpStatus.NOT_FOUND, 'Job card not found');
    // Shop scope (IDOR guard): a scoped foreman can only sign off jobs in their shop.
    if (!checkInInScope(scope, jc.checkInShop)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this job card belongs to another shop.');
    }
    if (jc.status !== 'FOREMAN_REVIEW') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Only FOREMAN_REVIEW cards can be signed off. Current status: ${jc.status}`,
      );
    }

    const now = new Date();
    await db
      .update(jobCards)
      .set({
        status: 'COMPLETED',
        foremanSignedOffBy: actorId,
        foremanSignedOffAt: now,
        foremanSignatureUrl: signatureUrl,
        // Clear any previous rejection on this card.
        foremanRejectionReason: null,
        foremanRejectedAt: null,
        updatedAt: now,
        updatedBy: actorId,
      })
      .where(eq(jobCards.id, jobCardId));

    // Pull the parent check-in so we can advance RO status to QC_OUT —
    // this is what the QC Out inspector dashboard watches for.
    const [signed] = await db
      .select({ vehicleCheckInId: jobCards.vehicleCheckInId })
      .from(jobCards)
      .where(eq(jobCards.id, jobCardId))
      .limit(1);
    if (signed?.vehicleCheckInId) {
      await setRoStatus(
        signed.vehicleCheckInId,
        'QC_OUT',
        actorId,
        `Foreman signed off job card ${jobCardId}`,
      );
    }

    void syncJobCardUpdateToEvolve(jobCardId).catch(() => { /* logged inside */ });

    return success('Job card signed off — eligible for QC Out', { id: jobCardId, status: 'COMPLETED' });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function rejectJobCard(request: FastifyRequest) {
  try {
    const { jobCardId } = request.params as any;
    const body = (request.body ?? {}) as { reason?: string; reassignTechnicianId?: string };
    const reason = (body.reason ?? '').trim();
    if (!reason) {
      return error(HttpStatus.BAD_REQUEST, 'A rejection reason is required.');
    }

    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    const scope = await resolveUserScope(request);

    const [jc] = await db
      .select({ id: jobCards.id, status: jobCards.status, checkInShop: vehicleCheckIns.shop })
      .from(jobCards)
      .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
      .where(eq(jobCards.id, jobCardId))
      .limit(1);
    if (!jc) return error(HttpStatus.NOT_FOUND, 'Job card not found');
    // Shop scope (IDOR guard): a scoped foreman can only reject jobs in their shop.
    if (!checkInInScope(scope, jc.checkInShop)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this job card belongs to another shop.');
    }
    if (jc.status !== 'FOREMAN_REVIEW') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Only FOREMAN_REVIEW cards can be rejected. Current status: ${jc.status}`,
      );
    }

    const now = new Date();
    await db.transaction(async (tx: any) => {
      // Card goes back to IN_PROGRESS — technician picks up where they
      // left off after addressing the foreman's note. Reset rework_count
      // on impacted items is not done here; foreman comment lives at the
      // card level for now.
      await tx
        .update(jobCards)
        .set({
          status: 'IN_PROGRESS',
          foremanRejectedAt: now,
          foremanRejectionReason: reason.slice(0, 2000),
          // Clear any prior sign-off (this card was once signed and then... no,
          // we already gated on FOREMAN_REVIEW only, so sign-off fields stay clean).
          updatedAt: now,
          updatedBy: actorId,
        })
        .where(eq(jobCards.id, jobCardId));

      // Reopen items: clear completedAt on every item so the tech can clock
      // back in. Their write-ups (completion_notes) stay so they can refine.
      await tx
        .update(jobCardItems)
        .set({ completedAt: null, completedBy: null, updatedAt: now })
        .where(eq(jobCardItems.jobCardId, jobCardId));

      // Optional reassign: foreman can route to a different technician.
      if (body.reassignTechnicianId) {
        await tx
          .update(jobCards)
          .set({ assignedTechnicianId: body.reassignTechnicianId, assignedAt: now })
          .where(eq(jobCards.id, jobCardId));
        await tx
          .update(jobCardItems)
          .set({ assignedTechnicianId: body.reassignTechnicianId, updatedAt: now })
          .where(eq(jobCardItems.jobCardId, jobCardId));
      }
    });

    void syncJobCardUpdateToEvolve(jobCardId).catch(() => { /* logged inside */ });

    return success('Job card rejected — returned to technician for rework', {
      id: jobCardId,
      status: 'IN_PROGRESS',
      reason,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Foreman / supervisor edit of the OEM write-up (Cause + Correction) on any
// job card item. Required by 3.8: "Both technician and foreman/supervisor
// should have write-up access." Logs to updatedBy/updatedAt; full edit
// history would be a separate audit table if Johan wants paper-trail later.
export async function foremanUpdateWriteUp(request: FastifyRequest) {
  try {
    const { itemId } = request.params as any;
    const body = (request.body ?? {}) as {
      diagnosisNotes?: string;
      completionNotes?: string;
    };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    // At least one field must be present and non-empty.
    const diag = typeof body.diagnosisNotes === 'string' ? body.diagnosisNotes.trim() : null;
    const corr = typeof body.completionNotes === 'string' ? body.completionNotes.trim() : null;
    if (diag === null && corr === null) {
      return error(HttpStatus.BAD_REQUEST, 'Provide diagnosisNotes and/or completionNotes to update.');
    }

    const scope = await resolveUserScope(request);
    const [item] = await db
      .select({ id: jobCardItems.id, checkInShop: vehicleCheckIns.shop })
      .from(jobCardItems)
      .leftJoin(jobCards, eq(jobCards.id, jobCardItems.jobCardId))
      .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
      .where(eq(jobCardItems.id, itemId))
      .limit(1);
    if (!item) return error(HttpStatus.NOT_FOUND, 'Job card item not found');
    // Shop scope (IDOR guard) — foreman can only edit items in their shop.
    if (!checkInInScope(scope, (item as any).checkInShop)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this item belongs to another shop.');
    }

    const now = new Date();
    const update: Record<string, unknown> = { updatedAt: now };
    if (diag !== null) update.diagnosisNotes = diag || null;
    if (corr !== null) update.completionNotes = corr || null;

    await db
      .update(jobCardItems)
      .set(update)
      .where(eq(jobCardItems.id, itemId));

    return success('Write-up updated', { itemId, updatedBy: actorId });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function listJobCardsAwaitingSignOff(request: FastifyRequest) {
  try {
    // Shop scoping: join the check-in spine so shopFilter can narrow by shop
    // (no-op for super-admin / ALL).
    const scope = await resolveUserScope(request);

    const rows = await db
      .select({
        id: jobCards.id,
        vehicleId: jobCards.vehicleId,
        status: jobCards.status,
        assignedTechnicianId: jobCards.assignedTechnicianId,
        priority: jobCards.priority,
        totalEstimate: jobCards.totalEstimate,
        currencyCode: jobCards.currencyCode,
        updatedAt: jobCards.updatedAt,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        technicianUsername: users.username,
      })
      .from(jobCards)
      .leftJoin(vehicles, eq(vehicles.id, jobCards.vehicleId))
      .leftJoin(users, eq(users.id, jobCards.assignedTechnicianId))
      .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
      .where(and(eq(jobCards.status, 'FOREMAN_REVIEW' as any), shopFilter(scope)))
      .orderBy(desc(jobCards.updatedAt));

    return success('OK', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
