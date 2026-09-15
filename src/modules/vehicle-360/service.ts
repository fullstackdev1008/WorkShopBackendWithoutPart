import { FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  vehicles,
  vehicleCheckIns,
  vehicleCheckInPhotos,
  customers,
  users,
  jobCards,
  jobCardItems,
  qcInspections,
  qcOutInspections,
  roStatusHistory,
  invoices,
  invoicePayments,
  gatePasses,
  warrantyParts,
  workshopAllocations,
  workshopBays,
  partRequests,
  jobCardItemReassignments,
} from '../../db/models';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { signUrl } from '../../middleware/s3';

type EventFamily =
  | 'GATE_IN'
  | 'QC_IN'
  | 'JOB_CARD'
  | 'APPROVAL'
  | 'WORK'
  | 'STATUS'
  | 'QC_OUT'
  | 'WASH'
  | 'INVOICE'
  | 'PAYMENT'
  | 'WARRANTY'
  | 'GATE_OUT'
  | 'PART_REQUEST'    // tech raises a request mid-repair
  | 'PART_PRICED'     // PM marks Available with a unit price (supplementary flow)
  | 'PART_DISPATCHED' // PM dispatches the part to the bay
  | 'MODIFICATION'    // SA re-shares after a supplementary part is priced
  | 'REWORK'          // Foreman allocates QC-failed vehicle back to a bay
  | 'ASSIGNMENT';     // SA / Foreman assigns a job-card item to a technician

type TimelineEvent = {
  at: string;
  actor: string | null;
  family: EventFamily;
  summary: string;
  refType: string | null;
  refId: string | null;
};

const fullName = (first?: string | null, last?: string | null) =>
  `${first ?? ''} ${last ?? ''}`.trim() || null;

// ─── Search ──────────────────────────────────────────────────────────────────
// One free-text endpoint backing the Vehicle 360 search bar. Matches reg #,
// VIN, receiving #, and customer name/phone. Returns up to 20 vehicles.
export async function search(request: FastifyRequest) {
  try {
    const q = String((request.query as any)?.q ?? '').trim();
    if (q.length < 2) return success('OK', []);

    const like = `%${q}%`;

    // Vehicles matching reg / VIN.
    const directMatches = await db
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        vin: vehicles.vin,
        customerId: vehicles.customerId,
      })
      .from(vehicles)
      .where(
        or(
          ilike(vehicles.registrationNumber, like),
          ilike(vehicles.vin, like),
        ),
      )
      .limit(20);

    // Vehicles owned by a customer whose name matches.
    const ownerMatches = await db
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        vin: vehicles.vin,
        customerId: vehicles.customerId,
      })
      .from(vehicles)
      .leftJoin(customers, eq(customers.id, vehicles.customerId))
      .where(or(ilike(customers.firstName, like), ilike(customers.lastName, like)))
      .limit(20);

    // Vehicles by receiving #.
    const receivingMatches = await db
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        vin: vehicles.vin,
        customerId: vehicles.customerId,
      })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicles.id, vehicleCheckIns.vehicleId))
      .where(ilike(vehicleCheckIns.receivingNo, like))
      .limit(20);

    // Dedupe by vehicle id.
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const row of [...directMatches, ...ownerMatches, ...receivingMatches]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= 20) break;
    }

    // Hydrate owner name + last visit for each.
    const enriched = await Promise.all(
      merged.map(async (v) => {
        let customerName: string | null = null;
        if (v.customerId) {
          const [c] = await db
            .select({ firstName: customers.firstName, lastName: customers.lastName })
            .from(customers)
            .where(eq(customers.id, v.customerId))
            .limit(1);
          customerName = fullName(c?.firstName, c?.lastName);
        }
        const [lastVisit] = await db
          .select({ at: vehicleCheckIns.checkInTime, roStatus: vehicleCheckIns.roStatus })
          .from(vehicleCheckIns)
          .where(eq(vehicleCheckIns.vehicleId, v.id))
          .orderBy(desc(vehicleCheckIns.checkInTime))
          .limit(1);
        return { ...v, customerName, lastVisitAt: lastVisit?.at ?? null, lastRoStatus: lastVisit?.roStatus ?? null };
      }),
    );

    return success('OK', enriched);
  } catch (err) {
    console.log('v360 search error', err);
    return serverError(err);
  }
}

// ─── Aggregator ──────────────────────────────────────────────────────────────
// Builds the unified timeline for a single vehicle. Reads from every phase's
// table but writes nothing — this is purely a read endpoint.
export async function getTimeline(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);
    if (!vehicle) return error(HttpStatus.NOT_FOUND, 'Vehicle not found');

    let customer: any = null;
    if (vehicle.customerId) {
      const [c] = await db
        .select({
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
          primaryEmail: customers.primaryEmail,
        })
        .from(customers)
        .where(eq(customers.id, vehicle.customerId))
        .limit(1);
      if (c) customer = { id: c.id, name: fullName(c.firstName, c.lastName), email: c.primaryEmail };
    }

    // All visits for this vehicle, newest first.
    const checkIns = await db
      .select()
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.vehicleId, vehicleId))
      .orderBy(desc(vehicleCheckIns.checkInTime));

    const checkInIds = checkIns.map((c) => c.id);

    // Bulk-fetch everything we need keyed by check-in id, then bucket per visit.
    const [
      statusEvents,
      cards,
      qcs,
      qcOuts,
      visitInvoices,
      visitGatePasses,
      entryPhotos,
      visitAllocations,
    ] = await Promise.all([
      checkInIds.length
        ? db
            .select({
              checkInId: roStatusHistory.checkInId,
              at: roStatusHistory.at,
              from: roStatusHistory.fromStatus,
              to: roStatusHistory.toStatus,
              reason: roStatusHistory.reason,
              actorUsername: users.username,
              actorEmail: users.email,
            })
            .from(roStatusHistory)
            .leftJoin(users, eq(users.id, roStatusHistory.byUserId))
            .where(inArray(roStatusHistory.checkInId, checkInIds))
            .orderBy(asc(roStatusHistory.at))
        : [],
      checkInIds.length
        ? db
            .select()
            .from(jobCards)
            .where(inArray(jobCards.vehicleCheckInId, checkInIds))
            .orderBy(asc(jobCards.createdAt))
        : [],
      checkInIds.length
        ? db
            .select()
            .from(qcInspections)
            .where(inArray(qcInspections.vehicleCheckInId, checkInIds))
        : [],
      checkInIds.length
        ? db
            .select()
            .from(qcOutInspections)
            .where(inArray(qcOutInspections.checkInId, checkInIds))
        : [],
      checkInIds.length
        ? db.select().from(invoices).where(inArray(invoices.checkInId, checkInIds))
        : [],
      checkInIds.length
        ? db.select().from(gatePasses).where(inArray(gatePasses.checkInId, checkInIds))
        : [],
      checkInIds.length
        ? db
            .select({
              checkInId: vehicleCheckInPhotos.vehicleCheckInId,
              imageUrl: vehicleCheckInPhotos.imageUrl,
            })
            .from(vehicleCheckInPhotos)
            .where(inArray(vehicleCheckInPhotos.vehicleCheckInId, checkInIds))
        : [],
      // Workshop allocations — one event per bay assignment / rework move.
      checkInIds.length
        ? db
            .select({
              id: workshopAllocations.id,
              checkInId: workshopAllocations.checkInId,
              allocatedAt: workshopAllocations.allocatedAt,
              releasedAt: workshopAllocations.releasedAt,
              priority: workshopAllocations.priority,
              repairCategory: workshopAllocations.repairCategory,
              notes: workshopAllocations.notes,
              bayNo: workshopBays.bayNo,
              actorUsername: users.username,
            })
            .from(workshopAllocations)
            .leftJoin(workshopBays, eq(workshopBays.id, workshopAllocations.bayId))
            .leftJoin(users, eq(users.id, workshopAllocations.allocatedBy))
            .where(inArray(workshopAllocations.checkInId, checkInIds))
            .orderBy(asc(workshopAllocations.allocatedAt))
        : [],
    ]);

    // Job-card items aggregated by job-card id (for "completed work" events).
    const cardIds = cards.map((c) => c.id);
    const completedItems = cardIds.length
      ? await db
          .select({
            id: jobCardItems.id,
            jobCardId: jobCardItems.jobCardId,
            description: jobCardItems.jobDescription,
            completedAt: jobCardItems.completedAt,
          })
          .from(jobCardItems)
          .where(and(inArray(jobCardItems.jobCardId, cardIds), ne(jobCardItems.completedAt as any, null as any)))
      : [];

    // Technician assignments — one event per (item × tech) assignment, with
    // the username of the assigned tech AND the actor who assigned them
    // (Foreman / SA). Pulled from job_card_items where assigned_at is set.
    const assignmentsRaw = cardIds.length
      ? await db
          .select({
            itemId: jobCardItems.id,
            jobCardId: jobCardItems.jobCardId,
            description: jobCardItems.jobDescription,
            assignedAt: jobCardItems.assignedAt,
            assignedTechId: jobCardItems.assignedTechnicianId,
            assignedById: jobCardItems.assignedBy,
            reworkNotes: jobCardItems.reworkNotes,
            reworkCount: jobCardItems.reworkCount,
          })
          .from(jobCardItems)
          .where(and(
            inArray(jobCardItems.jobCardId, cardIds),
            ne(jobCardItems.assignedAt as any, null as any),
          ))
      : [];
    // Reassignment audit — one row per historical handover. We use this
    // (instead of just the current jobCardItems.assignedAt) so the timeline
    // shows the full chain of tech swaps, not just the latest one.
    const itemIds = assignmentsRaw.map((a) => a.itemId);
    const reassignRows = itemIds.length
      ? await db
          .select({
            jobCardItemId: jobCardItemReassignments.jobCardItemId,
            fromTechId: jobCardItemReassignments.fromTechId,
            toTechId: jobCardItemReassignments.toTechId,
            reassignedBy: jobCardItemReassignments.reassignedBy,
            reason: jobCardItemReassignments.reason,
            priorSeconds: jobCardItemReassignments.priorSeconds,
            reassignedAt: jobCardItemReassignments.reassignedAt,
          })
          .from(jobCardItemReassignments)
          .where(inArray(jobCardItemReassignments.jobCardItemId, itemIds))
          .orderBy(asc(jobCardItemReassignments.reassignedAt))
      : [];

    // Hydrate usernames for techs + assigners — covers initial assigns AND
    // every reassignment row.
    const userIds = Array.from(new Set(
      [
        ...assignmentsRaw.flatMap((a) => [a.assignedTechId, a.assignedById]),
        ...reassignRows.flatMap((r) => [r.fromTechId, r.toTechId, r.reassignedBy]),
      ].filter(Boolean) as string[],
    ));
    const userRows = userIds.length
      ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds))
      : [];
    const usernameById = new Map(userRows.map((u) => [u.id, u.username]));

    const invoiceIds = visitInvoices.map((i) => i.id);
    const payments = invoiceIds.length
      ? await db.select().from(invoicePayments).where(inArray(invoicePayments.invoiceId, invoiceIds))
      : [];

    // Pull every part_request linked to any of the job cards on this vehicle.
    // We'll emit PART_REQUEST (raised), PART_PRICED (PM marked Available
    // with price), PART_DISPATCHED, MODIFICATION (status change), and the
    // approve/reject status flips on the part_request itself.
    const partReqs = cardIds.length
      ? await db
          .select({
            id: partRequests.id,
            jobCardId: partRequests.jobCardId,
            jobCardItemId: partRequests.jobCardItemId,
            partName: partRequests.partName,
            partNumber: partRequests.partNumber,
            quantity: partRequests.quantity,
            status: partRequests.status,
            requestedByTechnician: partRequests.requestedByTechnician,
            unitPrice: partRequests.unitPrice,
            extraLabourCost: partRequests.extraLabourCost,
            customerApprovalStatus: partRequests.customerApprovalStatus,
            approvedAt: partRequests.approvedAt,
            rejectedAt: partRequests.rejectedAt,
            requestedAt: partRequests.requestedAt,
            updatedAt: partRequests.updatedAt,
            requesterUsername: users.username,
          })
          .from(partRequests)
          .leftJoin(users, eq(users.id, partRequests.requestedBy))
          .where(inArray(partRequests.jobCardId, cardIds))
      : [];

    // Warranty parts for this vehicle (across visits).
    const warranty = await db
      .select()
      .from(warrantyParts)
      .where(eq(warrantyParts.vehicleId, vehicleId))
      .orderBy(desc(warrantyParts.removedAt));

    // Current workshop bay (if vehicle is on the floor right now).
    let currentBay: { number: string | null; location: string | null } | null = null;
    const activeCheckIn = checkIns.find((c) => !c.completedAt);
    if (activeCheckIn) {
      const [alloc] = await db
        .select({ bayNo: workshopBays.bayNo, location: workshopBays.location })
        .from(workshopAllocations)
        .leftJoin(workshopBays, eq(workshopBays.id, workshopAllocations.bayId))
        .where(
          and(
            eq(workshopAllocations.checkInId, activeCheckIn.id),
            sql`${workshopAllocations.releasedAt} IS NULL`,
          ),
        )
        .limit(1);
      if (alloc) currentBay = { number: alloc.bayNo ?? null, location: alloc.location ?? null };
    }

    // Build per-visit events.
    // Pre-sign all entry photos in one batch so the per-visit .map can stay
    // synchronous. signUrl returns the absolute URL (S3 / local /uploads).
    const signedPhotosByCheckIn = new Map<string, string[]>();
    for (const p of entryPhotos) {
      const arr = signedPhotosByCheckIn.get(p.checkInId) ?? [];
      arr.push(p.imageUrl);
      signedPhotosByCheckIn.set(p.checkInId, arr);
    }
    const signedPhotos: Record<string, string[]> = {};
    await Promise.all(
      Array.from(signedPhotosByCheckIn.entries()).map(async ([cid, urls]) => {
        signedPhotos[cid] = (
          await Promise.all(urls.map((u) => signUrl(u)))
        ).filter((u): u is string => !!u);
      }),
    );

    // ─── Service-visit filter ──────────────────────────────────────────────
    // Vehicle 360 is a service history, not a gate-movement log. A check-in
    // that never progressed past Gate Entry (no QC, no job card, no workshop
    // process) — including one that was cancelled right after arrival — is not
    // a real service visit and must be excluded. A check-in qualifies when it
    // shows any actual workshop activity: a job card, a QC in/out inspection,
    // a workshop bay allocation, an invoice, or an RO status that advanced
    // beyond the gate-arrival stage.
    const GATE_ENTRY_ONLY_RO_STATUSES = new Set<string | null>([null, 'ARRIVED']);
    const cardCheckInIds = new Set(cards.map((c) => c.vehicleCheckInId));
    const qcCheckInIds = new Set(qcs.map((q) => q.vehicleCheckInId));
    const qcOutCheckInIds = new Set(qcOuts.map((q) => q.checkInId));
    const allocCheckInIds = new Set(visitAllocations.map((a) => a.checkInId));
    const invoiceCheckInIds = new Set(visitInvoices.map((i) => i.checkInId));
    const isServiceVisit = (ci: (typeof checkIns)[number]) =>
      cardCheckInIds.has(ci.id) ||
      qcCheckInIds.has(ci.id) ||
      qcOutCheckInIds.has(ci.id) ||
      allocCheckInIds.has(ci.id) ||
      invoiceCheckInIds.has(ci.id) ||
      !GATE_ENTRY_ONLY_RO_STATUSES.has(ci.roStatus ?? null);
    const serviceCheckIns = checkIns.filter(isServiceVisit);

    const visits = serviceCheckIns.map((ci) => {
      const events: TimelineEvent[] = [];

      events.push({
        at: ci.checkInTime.toISOString(),
        actor: null,
        family: 'GATE_IN',
        summary: `Vehicle checked in${ci.receivingNo ? ` (${ci.receivingNo})` : ''} · odo ${ci.odometerReading}`,
        refType: 'check_in',
        refId: ci.id,
      });

      for (const q of qcs.filter((x) => x.vehicleCheckInId === ci.id)) {
        if (q.completedAt) {
          events.push({
            at: q.completedAt.toISOString(),
            actor: null,
            family: 'QC_IN',
            summary: `QC in-check completed${q.overallStatus ? ` — ${q.overallStatus}` : ''}`,
            refType: 'qc_inspection',
            refId: q.id,
          });
        }
      }

      for (const c of cards.filter((x) => x.vehicleCheckInId === ci.id)) {
        events.push({
          at: c.createdAt.toISOString(),
          actor: null,
          family: 'JOB_CARD',
          summary: `Job card created (${c.status}) · estimate ${Number(c.totalEstimate ?? 0).toFixed(2)} ${c.currencyCode ?? ''}`,
          refType: 'job_card',
          refId: c.id,
        });
        if (c.approvedAt) {
          events.push({
            at: c.approvedAt.toISOString(),
            actor: null,
            family: 'APPROVAL',
            summary: `Customer approved job card (${c.status})`,
            refType: 'job_card',
            refId: c.id,
          });
        }
        const cardItems = completedItems.filter((i) => i.jobCardId === c.id);
        for (const it of cardItems) {
          if (it.completedAt) {
            events.push({
              at: it.completedAt.toISOString(),
              actor: null,
              family: 'WORK',
              summary: `Completed: ${it.description}`,
              refType: 'job_card_item',
              refId: it.id,
            });
          }
        }
        // Technician assignment events — emit one event per assignment AND
        // one per reassignment, so the timeline shows the full chain of
        // tech swaps (not just the latest assignedAt on the item).
        const cardAssignments = assignmentsRaw.filter((a) => a.jobCardId === c.id);
        for (const a of cardAssignments) {
          if (!a.assignedAt) continue;

          // History rows for this item, oldest first.
          const itemReassigns = reassignRows
            .filter((r) => r.jobCardItemId === a.itemId)
            .sort((x, y) => +new Date(x.reassignedAt) - +new Date(y.reassignedAt));

          // INITIAL assignment event — use the oldest reassign row's
          // fromTechId as the original tech if available, otherwise the
          // current assignedTechId. Timestamp is assignedAt (the item's
          // create-time assignment).
          const originalTechId = itemReassigns[0]?.fromTechId ?? a.assignedTechId;
          if (originalTechId && itemReassigns.length === 0) {
            // No reassignments yet: a is the only assignment.
            const techName = usernameById.get(a.assignedTechId!) ?? null;
            const byName = a.assignedById ? usernameById.get(a.assignedById) ?? null : null;
            const isRework = (a.reworkCount ?? 0) > 0;
            const verb = isRework ? 'Reassigned for rework' : 'Assigned';
            const reworkSuffix = isRework && a.reworkNotes ? ` · brief: "${a.reworkNotes}"` : '';
            events.push({
              at: (a.assignedAt as Date).toISOString(),
              actor: byName,
              family: 'ASSIGNMENT',
              summary: `${verb} ${a.description} → ${techName ?? 'unassigned'}${byName ? ` by ${byName}` : ''}${reworkSuffix}`,
              refType: 'job_card_item',
              refId: a.itemId,
            });
          } else if (originalTechId) {
            // Reassignments exist — emit the initial assignment using the
            // first audit row's fromTechId and (best-effort) the earliest
            // moment that's still before the first reassignment.
            const origTechName = usernameById.get(originalTechId) ?? null;
            const initialAt = new Date(Math.min(
              new Date(a.assignedAt as any).getTime(),
              new Date(itemReassigns[0].reassignedAt as any).getTime() - 1,
            )).toISOString();
            events.push({
              at: initialAt,
              actor: null,
              family: 'ASSIGNMENT',
              summary: `Assigned ${a.description} → ${origTechName ?? 'unassigned'}`,
              refType: 'job_card_item',
              refId: a.itemId,
            });
          }

          // REASSIGNMENT events — one per historical handover.
          for (const r of itemReassigns) {
            const fromName = r.fromTechId ? usernameById.get(r.fromTechId) ?? null : null;
            const toName = r.toTechId ? usernameById.get(r.toTechId) ?? null : null;
            const byName = r.reassignedBy ? usernameById.get(r.reassignedBy) ?? null : null;
            const priorMin = Math.floor((r.priorSeconds ?? 0) / 60);
            const priorChunk = priorMin > 0
              ? ` · ${priorMin >= 60 ? `${Math.floor(priorMin / 60)}h ${priorMin % 60}m` : `${priorMin}m`} prior work by ${fromName ?? 'unassigned'}`
              : '';
            const reasonChunk = r.reason ? ` · reason: "${r.reason}"` : '';
            events.push({
              at: (r.reassignedAt as Date).toISOString(),
              actor: byName,
              family: 'ASSIGNMENT',
              summary: `Reassigned ${a.description} → ${toName ?? 'unassigned'}${byName ? ` by ${byName}` : ''}${priorChunk}${reasonChunk}`,
              refType: 'job_card_item',
              refId: a.itemId,
            });
          }
        }
      }

      for (const h of statusEvents.filter((x) => x.checkInId === ci.id)) {
        events.push({
          at: (h.at as Date).toISOString(),
          actor: h.actorUsername ?? h.actorEmail,
          family: 'STATUS',
          summary: `Status ${h.from ?? '∅'} → ${h.to}${h.reason ? ` · ${h.reason}` : ''}`,
          refType: 'ro_status_history',
          refId: null,
        });
      }

      // Workshop allocations — initial bay assignment + rework moves.
      const visitCardIdsForAlloc = new Set(cards.filter((x) => x.vehicleCheckInId === ci.id).map((c) => c.id));
      void visitCardIdsForAlloc;
      for (const wa of visitAllocations.filter((x) => x.checkInId === ci.id)) {
        const isRework = !!(wa.notes && wa.notes.toLowerCase().includes('rework'));
        events.push({
          at: (wa.allocatedAt as Date).toISOString(),
          actor: wa.actorUsername ?? null,
          family: isRework ? 'REWORK' : 'JOB_CARD',
          summary: `${isRework ? 'Rework allocated' : 'Bay allocated'} — ${wa.bayNo ?? '—'} · ${wa.priority} · ${wa.repairCategory}${wa.notes ? ` · "${wa.notes}"` : ''}`,
          refType: 'workshop_allocation',
          refId: wa.id,
        });
      }

      // Part requests on this visit's job cards.
      const visitPartReqCardIds = new Set(cards.filter((x) => x.vehicleCheckInId === ci.id).map((c) => c.id));
      const visitPartReqs = partReqs.filter((p) => visitPartReqCardIds.has(p.jobCardId));
      for (const pr of visitPartReqs) {
        // 1. Raised (always)
        events.push({
          at: (pr.requestedAt as Date).toISOString(),
          actor: pr.requesterUsername ?? null,
          family: 'PART_REQUEST',
          summary: `${pr.requestedByTechnician ? 'Tech requested' : 'SA requested'} part: ${pr.partName}${pr.partNumber ? ` (${pr.partNumber})` : ''} × ${pr.quantity}`,
          refType: 'part_request',
          refId: pr.id,
        });
        // 2. Priced / Available (PM action)
        if (pr.status === 'available' || pr.status === 'dispatched') {
          const priced = pr.unitPrice != null;
          events.push({
            at: (pr.updatedAt as Date).toISOString(),
            actor: null,
            family: 'PART_PRICED',
            summary: priced
              ? `Marked available @ ${Number(pr.unitPrice).toFixed(2)}${Number(pr.extraLabourCost ?? 0) > 0 ? ` + labour ${Number(pr.extraLabourCost).toFixed(2)}` : ''}${pr.customerApprovalStatus === 'PENDING' ? ' — awaiting customer approval' : ''}`
              : `Part marked available: ${pr.partName}`,
            refType: 'part_request',
            refId: pr.id,
          });
        }
        // 3. Dispatched
        if (pr.status === 'dispatched') {
          events.push({
            at: (pr.updatedAt as Date).toISOString(),
            actor: null,
            family: 'PART_DISPATCHED',
            summary: `Part dispatched: ${pr.partName}`,
            refType: 'part_request',
            refId: pr.id,
          });
        }
        // 4. Supplementary customer approval / rejection
        if (pr.customerApprovalStatus === 'APPROVED' && pr.approvedAt) {
          events.push({
            at: (pr.approvedAt as Date).toISOString(),
            actor: null,
            family: 'MODIFICATION',
            summary: `Customer APPROVED extra part: ${pr.partName} (${Number(pr.unitPrice ?? 0).toFixed(2)})`,
            refType: 'part_request',
            refId: pr.id,
          });
        }
        if (pr.customerApprovalStatus === 'REJECTED' && pr.rejectedAt) {
          events.push({
            at: (pr.rejectedAt as Date).toISOString(),
            actor: null,
            family: 'MODIFICATION',
            summary: `Customer REJECTED extra part: ${pr.partName} — reverted to original scope`,
            refType: 'part_request',
            refId: pr.id,
          });
        }
      }

      for (const q of qcOuts.filter((x) => x.checkInId === ci.id)) {
        events.push({
          at: q.completedAt.toISOString(),
          actor: null,
          family: 'QC_OUT',
          summary: `QC out — ${q.overallStatus}`,
          refType: 'qc_out_inspection',
          refId: q.id,
        });
      }

      for (const inv of visitInvoices.filter((x) => x.checkInId === ci.id)) {
        if (inv.generatedAt) {
          events.push({
            at: (inv.generatedAt as Date).toISOString(),
            actor: null,
            family: 'INVOICE',
            summary: `Invoice ${inv.invoiceNo} generated · ${inv.currencyCode} ${Number(inv.totalAmount).toFixed(2)}`,
            refType: 'invoice',
            refId: inv.id,
          });
        }
        const invPays = payments.filter((p) => p.invoiceId === inv.id);
        for (const p of invPays) {
          events.push({
            at: (p.paidAt as Date).toISOString(),
            actor: null,
            family: 'PAYMENT',
            summary: `Payment ${inv.currencyCode} ${Number(p.amount).toFixed(2)} via ${p.mode}${p.referenceNo ? ` (${p.referenceNo})` : ''}`,
            refType: 'invoice_payment',
            refId: p.id,
          });
        }
      }

      for (const gp of visitGatePasses.filter((x) => x.checkInId === ci.id)) {
        if (gp.redeemedAt) {
          events.push({
            at: (gp.redeemedAt as Date).toISOString(),
            actor: null,
            family: 'GATE_OUT',
            summary: `Vehicle released via ${gp.code}${gp.odometerOut ? ` · odo ${gp.odometerOut}` : ''}`,
            refType: 'gate_pass',
            refId: gp.id,
          });
        }
      }

      // Warranty items removed on this visit.
      const visitCardIds = new Set(cards.filter((x) => x.vehicleCheckInId === ci.id).map((c) => c.id));
      const visitCardItemIds = new Set(
        completedItems.filter((it) => visitCardIds.has(it.jobCardId)).map((i) => i.id),
      );
      for (const w of warranty) {
        if (w.jobCardItemId && visitCardItemIds.has(w.jobCardItemId)) {
          events.push({
            at: (w.removedAt as Date).toISOString(),
            actor: null,
            family: 'WARRANTY',
            summary: `Warranty tag ${w.tagNo} — ${w.partName} (${w.status})`,
            refType: 'warranty_part',
            refId: w.id,
          });
        }
      }

      events.sort((a, b) => +new Date(a.at) - +new Date(b.at));

      const visitInvoiceRow = visitInvoices.find((x) => x.checkInId === ci.id && x.status !== 'VOID');
      const totalSpend = visitInvoiceRow ? Number(visitInvoiceRow.totalAmount) : null;

      // Per-visit detail payload used by the FE service tab (photos, QC,
      // job card summary). The events array still drives the timeline.
      const visitPhotos = signedPhotos[ci.id] ?? [];
      const visitQc = qcs.find((q) => q.vehicleCheckInId === ci.id) ?? null;
      const visitCard = cards.find((c) => c.vehicleCheckInId === ci.id) ?? null;

      return {
        checkInId: ci.id,
        receivingNo: ci.receivingNo,
        arrivedAt: ci.checkInTime,
        releasedAt: ci.completedAt,
        roStatus: ci.roStatus,
        odometerIn: ci.odometerReading,
        odometerOut: visitGatePasses.find((g) => g.checkInId === ci.id)?.odometerOut ?? null,
        totalSpend,
        currency: visitInvoiceRow?.currencyCode ?? null,
        entryPhotos: visitPhotos,
        qcInspection: visitQc
          ? {
              id: visitQc.id,
              overallStatus: visitQc.overallStatus,
              completedAt: visitQc.completedAt,
            }
          : null,
        jobCard: visitCard
          ? {
              id: visitCard.id,
              status: visitCard.status,
              serviceType: visitCard.serviceType,
              totalEstimate: visitCard.totalEstimate,
              currencyCode: visitCard.currencyCode,
            }
          : null,
        events,
      };
    });

    // Insights.
    const allDescriptions = cardIds.length
      ? await db
          .select({
            jobCardId: jobCardItems.jobCardId,
            description: jobCardItems.jobDescription,
            createdAt: jobCardItems.createdAt,
          })
          .from(jobCardItems)
          .where(inArray(jobCardItems.jobCardId, cardIds))
      : [];

    // Repeat-fault: same lowercase description seen across 2+ visits within 90 days.
    const byDesc = new Map<string, Date[]>();
    for (const d of allDescriptions) {
      const key = (d.description ?? '').trim().toLowerCase();
      if (!key) continue;
      const arr = byDesc.get(key) ?? [];
      arr.push(d.createdAt as Date);
      byDesc.set(key, arr);
    }
    const repeatFaults: { description: string; occurrences: number; lastSeenAt: string }[] = [];
    for (const [key, dates] of byDesc) {
      if (dates.length < 2) continue;
      dates.sort((a, b) => +a - +b);
      // Check any pair within 90 days.
      let flagged = false;
      for (let i = 1; i < dates.length; i++) {
        const gap = (+dates[i] - +dates[i - 1]) / (1000 * 60 * 60 * 24);
        if (gap <= 90) { flagged = true; break; }
      }
      if (flagged) {
        repeatFaults.push({
          description: key,
          occurrences: dates.length,
          lastSeenAt: dates[dates.length - 1].toISOString(),
        });
      }
    }

    const spendByVisit = visits.map((v) => ({
      checkInId: v.checkInId,
      arrivedAt: v.arrivedAt,
      total: v.totalSpend ?? 0,
    }));

    const outstandingBalance = visitInvoices
      .filter((i) => i.status !== 'PAID' && i.status !== 'VOID')
      .reduce((s, i) => s + (Number(i.totalAmount) - Number(i.paidAmount)), 0);

    const openWarranty = warranty.filter((w) => w.status === 'HELD' || w.status === 'PENDING_APPROVAL');

    return success('OK', {
      vehicle: {
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        vin: vehicle.vin,
        status: vehicle.status,
      },
      customer,
      currentCheckIn: activeCheckIn
        ? {
            id: activeCheckIn.id,
            roStatus: activeCheckIn.roStatus,
            roStatusAt: activeCheckIn.roStatusAt,
            arrivedAt: activeCheckIn.checkInTime,
            bay: currentBay,
          }
        : null,
      summary: {
        visitCount: serviceCheckIns.length,
        lifetimeSpend: visits.reduce((s, v) => s + (v.totalSpend ?? 0), 0),
        currency: visits.find((v) => v.currency)?.currency ?? null,
      },
      visits,
      warranty: { open: openWarranty, all: warranty },
      invoices: visitInvoices,
      insights: { repeatFaults, spendByVisit, outstandingBalance },
    });
  } catch (err) {
    console.log('v360 timeline error', err);
    return serverError(err);
  }
}
