import { FastifyRequest } from 'fastify';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  partRequests,
  jobCards,
  jobCardItems,
  vehicles,
} from '../../db/models';
import {
  partIdParamSchema,
  markUnavailableSchema,
} from './dto';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';

// ─── Dashboard ───────────────────────────────────────────────────────────────
export async function getDashboard(_request: FastifyRequest) {
  try {
    // Count by status
    const statusCounts = await db
      .select({ status: partRequests.status, total: count() })
      .from(partRequests)
      .groupBy(partRequests.status);

    const stats = { pending: 0, available: 0, unavailable: 0, dispatched: 0 };
    for (const row of statusCounts) {
      stats[row.status as keyof typeof stats] = Number(row.total);
    }

    // Fetch all part requests with vehicle + job card + job card item info
    const rows = await db
      .select({
        id: partRequests.id,
        partName: partRequests.partName,
        partNumber: partRequests.partNumber,
        quantity: partRequests.quantity,
        status: partRequests.status,
        expectedTime: partRequests.expectedTime,
        requestedAt: partRequests.requestedAt,
        requestedByTechnician: partRequests.requestedByTechnician,
        vehicleNumber: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        serviceDescription: jobCardItems.jobDescription,
        jobCardId: partRequests.jobCardId,
        jobCardStatus: jobCards.status,
        jobCardCreatedAt: jobCards.createdAt,
      })
      .from(partRequests)
      .innerJoin(vehicles, eq(partRequests.vehicleId, vehicles.id))
      .innerJoin(jobCardItems, eq(partRequests.jobCardItemId, jobCardItems.id))
      .innerJoin(jobCards, eq(partRequests.jobCardId, jobCards.id))
      .orderBy(
        sql`CASE WHEN ${partRequests.status} = 'pending' THEN 0 WHEN ${partRequests.status} = 'available' THEN 1 WHEN ${partRequests.status} = 'unavailable' THEN 2 ELSE 3 END`,
        partRequests.requestedAt,
      );

    // Group part requests by job card
    const groupMap = new Map<string, {
      jobCardId: string;
      vehicleNumber: string;
      vehicleModel: string;
      jobCardStatus: string;
      createdAt: string;
      partRequests: Array<{
        id: string;
        partName: string;
        partNumber: string;
        vehicleNumber: string;
        vehicleModel: string;
        serviceDescription: string;
        status: string;
        requestTime: string;
        expectedTime: string | null;
        showDispatchInfo: boolean;
        requestedByTechnician: boolean;
      }>;
    }>();

    for (const r of rows) {
      const vehicleModel = `${r.vehicleBrand} ${r.vehicleModel}`;
      const vehicleNumber = r.vehicleNumber || '';

      if (!groupMap.has(r.jobCardId)) {
        groupMap.set(r.jobCardId, {
          jobCardId: r.jobCardId,
          vehicleNumber,
          vehicleModel,
          jobCardStatus: r.jobCardStatus,
          createdAt: r.jobCardCreatedAt.toISOString(),
          partRequests: [],
        });
      }

      groupMap.get(r.jobCardId)!.partRequests.push({
        id: r.id,
        partName: r.partName,
        partNumber: r.partNumber || `Qty: ${r.quantity}`,
        vehicleNumber,
        vehicleModel,
        serviceDescription: r.serviceDescription,
        status: r.status,
        requestTime: new Date(r.requestedAt).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        expectedTime: r.expectedTime,
        showDispatchInfo: false,
        requestedByTechnician: r.requestedByTechnician,
      });
    }

    // Sort groups: those with pending parts first, then by creation date descending
    const jobCardGroups = Array.from(groupMap.values()).sort((a, b) => {
      const aHasPending = a.partRequests.some((p) => p.status === 'pending') ? 0 : 1;
      const bHasPending = b.partRequests.some((p) => p.status === 'pending') ? 0 : 1;
      if (aHasPending !== bHasPending) return aHasPending - bHasPending;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return success('Dashboard fetched successfully', { stats, jobCardGroups });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Part Requests (filterable) ─────────────────────────────────────────
export async function getPartRequests(request: FastifyRequest) {
  try {
    const { status } = request.query as { status?: string };

    const validStatuses = ['pending', 'available', 'unavailable', 'dispatched'];
    if (status && !validStatuses.includes(status)) {
      return error(HttpStatus.BAD_REQUEST, `Invalid status filter. Allowed: ${validStatuses.join(', ')}`);
    }

    const rows = await db
      .select({
        id: partRequests.id,
        partName: partRequests.partName,
        partNumber: partRequests.partNumber,
        quantity: partRequests.quantity,
        status: partRequests.status,
        expectedTime: partRequests.expectedTime,
        requestedAt: partRequests.requestedAt,
        requestedByTechnician: partRequests.requestedByTechnician,
        vehicleNumber: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        serviceDescription: jobCardItems.jobDescription,
      })
      .from(partRequests)
      .innerJoin(vehicles, eq(partRequests.vehicleId, vehicles.id))
      .innerJoin(jobCardItems, eq(partRequests.jobCardItemId, jobCardItems.id))
      .where(
        status
          ? eq(partRequests.status, status as 'pending' | 'available' | 'unavailable' | 'dispatched')
          : undefined,
      )
      .orderBy(partRequests.requestedAt);

    const data = rows.map((r: any) => ({
      id: r.id,
      partName: r.partName,
      partNumber: r.partNumber || `Qty: ${r.quantity}`,
      vehicleNumber: r.vehicleNumber || '',
      vehicleModel: `${r.vehicleBrand} ${r.vehicleModel}`,
      serviceDescription: r.serviceDescription,
      status: r.status,
      requestTime: new Date(r.requestedAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      expectedTime: r.expectedTime,
    }));

    return success('Part requests fetched successfully', data);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Mark Part as Available ───────────────────────────────────────────────────
export async function markAvailable(request: FastifyRequest) {
  try {
    const { partId } = request.params as any;
    const body = (request.body ?? {}) as { unitPrice?: number; extraLabourCost?: number };
    const userId = await resolveActorId(request);
    const now = new Date();

    const [part] = await db
      .select({
        id: partRequests.id,
        status: partRequests.status,
        jobCardId: partRequests.jobCardId,
        jobCardItemId: partRequests.jobCardItemId,
        vehicleId: partRequests.vehicleId,
        partName: partRequests.partName,
        partNumber: partRequests.partNumber,
        quantity: partRequests.quantity,
        requestedByTechnician: partRequests.requestedByTechnician,
      })
      .from(partRequests)
      .where(eq(partRequests.id, partId))
      .limit(1);

    if (!part) {
      return error(HttpStatus.NOT_FOUND, 'Part request not found');
    }
    if (part.status !== 'pending') {
      return error(HttpStatus.BAD_REQUEST, `Part is already ${part.status}`);
    }

    // For tech-raised requests we require a unit price so the customer-
    // approval flow has a number to show. SA-raised pre-share requests don't
    // strictly need one here (they were priced on the original estimate).
    const needsPrice = part.requestedByTechnician;
    const unitPrice = Number(body.unitPrice ?? 0);
    const extraLabour = Number(body.extraLabourCost ?? 0);
    if (needsPrice && (!unitPrice || unitPrice <= 0)) {
      return error(HttpStatus.BAD_REQUEST, 'Unit price is required for technician-raised requests');
    }

    const isSupplementary = part.requestedByTechnician && (unitPrice > 0 || extraLabour > 0);
    const additionalCost = (unitPrice * part.quantity) + extraLabour;

    // Update the part_request status + persist pricing decision.
    await db
      .update(partRequests)
      .set({
        status: 'available',
        unitPrice: unitPrice ? unitPrice.toFixed(2) : null,
        extraLabourCost: extraLabour.toFixed(2),
        customerApprovalStatus: isSupplementary ? 'PENDING' : 'NOT_REQUIRED',
        updatedBy: userId,
        updatedAt: now,
      })
      .where(eq(partRequests.id, partId));

    // Supplementary approval path: insert a brand-new job_card_items row
    // for the extra part (so the SA dashboard renders it as a distinct line),
    // recalculate job-card totals, flip status to MODIFICATION_REQUESTED.
    // We DO NOT auto-share or notify the customer — the SA still owns the
    // "Share Estimate with Customer" action so they can review the addition
    // first. The existing approve-by-token hook will flip the part_request
    // to APPROVED when the customer confirms.
    if (isSupplementary && additionalCost > 0) {
      const [jc] = await db
        .select({
          id: jobCards.id,
          subtotal: jobCards.subtotal,
          taxLabel: jobCards.taxLabel,
          taxPercentage: jobCards.taxPercentage,
          totalEstimate: jobCards.totalEstimate,
          currencyCode: jobCards.currencyCode,
        })
        .from(jobCards)
        .where(eq(jobCards.id, part.jobCardId))
        .limit(1);
      if (!jc) return error(HttpStatus.NOT_FOUND, 'Job card not found');

      // Determine the sort order for the new line — push it to the end of
      // the existing list so it appears below the original items.
      const [maxRow] = await db
        .select({ maxSort: sql<number>`COALESCE(MAX(${jobCardItems.sortOrder}), 0)` })
        .from(jobCardItems)
        .where(eq(jobCardItems.jobCardId, jc.id));
      const nextSort = Number(maxRow?.maxSort ?? 0) + 1;

      const newSubtotal  = Number(jc.subtotal ?? 0) + additionalCost;
      const taxPct       = Number(jc.taxPercentage ?? 0);
      const newTaxAmount = (newSubtotal * taxPct) / 100;
      const newTotal     = newSubtotal + newTaxAmount;

      await db.transaction(async (tx: any) => {
        // Insert the supplementary line item. partsRequired = part number
        // (or part name if no number), so the SA's "View Parts" list shows
        // it. isApprovedByCustomer=null means "not yet decided" — the
        // approve-by-token hook will flip it to true on customer approval,
        // or false on rejection.
        const lineTotal = (unitPrice * part.quantity) + extraLabour;
        const [insertedItem] = await tx
          .insert(jobCardItems)
          .values({
            jobCardId: jc.id,
            jobDescription: part.partName,
            partsRequired: part.partNumber || part.partName,
            partsCost: unitPrice.toFixed(2),
            labourCost: extraLabour.toFixed(2),
            quantity: part.quantity,
            lineTotal: lineTotal.toFixed(2),
            sortOrder: nextSort,
            isApprovedByCustomer: null,
          })
          .returning({ id: jobCardItems.id });

        // Link the supplementary item back to the part_request so the
        // customer-approval hook knows exactly which row to assign to the
        // original requesting technician.
        // Also re-point job_card_item_id to the new supplementary row so
        // the original item (where the tech raised the request) is no
        // longer "blocked by" this part on the completion guard. The
        // supplementary item becomes the owner of the part going forward.
        await tx
          .update(partRequests)
          .set({
            jobCardItemId: insertedItem.id,
            suppJobCardItemId: insertedItem.id,
            updatedAt: now,
          })
          .where(eq(partRequests.id, partId));

        await tx
          .update(jobCards)
          .set({
            status: 'MODIFICATION_REQUESTED',
            subtotal: newSubtotal.toFixed(2),
            taxAmount: newTaxAmount.toFixed(2),
            totalEstimate: newTotal.toFixed(2),
            modificationNote: `Additional part: ${part.partName}${part.partNumber ? ` (${part.partNumber})` : ''} × ${part.quantity} @ ${jc.currencyCode} ${unitPrice.toFixed(2)}${extraLabour > 0 ? ` + labour ${jc.currencyCode} ${extraLabour.toFixed(2)}` : ''}. Awaiting customer approval.`,
            updatedAt: now,
            updatedBy: userId,
          })
          .where(eq(jobCards.id, jc.id));
      });

      return success('Part marked available — re-share estimate with customer to get approval', {
        id: partId,
        status: 'available',
        customerApprovalStatus: 'PENDING',
        newTotalEstimate: newTotal.toFixed(2),
      });
    }

    // Non-supplementary path (SA-raised, or zero-cost) — original behaviour.
    await checkAndConfirmJobCard(part.jobCardId, part.vehicleId, userId, now);

    return success('Part marked as available', { id: partId, status: 'available' });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Mark Part as Unavailable ─────────────────────────────────────────────────
export async function markUnavailable(request: FastifyRequest) {
  try {
    const { partId } = request.params as any;
    const { expectedTime } = request.body as any;
    const userId = await resolveActorId(request);
    const now = new Date();

    const [part] = await db
      .select({ id: partRequests.id, status: partRequests.status, jobCardId: partRequests.jobCardId, vehicleId: partRequests.vehicleId })
      .from(partRequests)
      .where(eq(partRequests.id, partId))
      .limit(1);

    if (!part) {
      return error(HttpStatus.NOT_FOUND, 'Part request not found');
    }
    if (part.status !== 'pending') {
      return error(HttpStatus.BAD_REQUEST, `Part is already ${part.status}`);
    }

    await db
      .update(partRequests)
      .set({ status: 'unavailable', expectedTime, updatedBy: userId, updatedAt: now })
      .where(eq(partRequests.id, partId));

    await checkAndConfirmJobCard(part.jobCardId, part.vehicleId, userId, now);

    return success('Part marked as unavailable', { id: partId, status: 'unavailable', expectedTime });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Mark Part as Dispatched to Bay ──────────────────────────────────────────
export async function markDispatched(request: FastifyRequest) {
  try {
    const { partId } = request.params as any;
    const userId = await resolveActorId(request);
    const now = new Date();

    const [part] = await db
      .select({ id: partRequests.id, status: partRequests.status })
      .from(partRequests)
      .where(eq(partRequests.id, partId))
      .limit(1);

    if (!part) {
      return error(HttpStatus.NOT_FOUND, 'Part request not found');
    }
    // Allow dispatch from BOTH 'available' (priced + ready) AND
    // 'unavailable' (part was missing; PM now confirms it physically
    // arrived even if before/after the ETA). ETAs are estimates, so the
    // PM is the authoritative source of "the part is in hand now."
    if (part.status !== 'available' && part.status !== 'unavailable') {
      return error(HttpStatus.BAD_REQUEST, `Only available or unavailable parts can be dispatched. Current status: ${part.status}`);
    }

    await db
      .update(partRequests)
      .set({ status: 'dispatched', updatedBy: userId, updatedAt: now })
      .where(eq(partRequests.id, partId));

    return success('Part dispatched to bay', { id: partId, status: 'dispatched' });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Auto-confirm job card when all parts are responded ──────────────────────
async function checkAndConfirmJobCard(
  jobCardId: string,
  vehicleId: string,
  userId: string | null,
  now: Date,
) {
  // Count remaining pending parts for this job card
  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(partRequests)
    .where(
      and(
        eq(partRequests.jobCardId, jobCardId),
        eq(partRequests.status, 'pending'),
      ),
    );

  if (Number(remaining) === 0) {
    // All parts responded — confirm job card. Also clears any parts
    // reconfirmation flag set by an estimate-affecting edit (the PARTS_CONFIRMED
    // status-preserving case), which re-enables Share. Setting status to
    // PARTS_CONFIRMED is the correct target for every path that reaches here
    // (first-time PENDING_PARTS, post-share regression, or preserved PARTS_CONFIRMED).
    await db.transaction(async (tx: any) => {
      await tx
        .update(jobCards)
        .set({ status: 'PARTS_CONFIRMED' as any, partsReconfirmationRequired: false, updatedAt: now, updatedBy: userId })
        .where(eq(jobCards.id, jobCardId));

      await tx
        .update(vehicles)
        .set({ status: 'Job Card (Parts Approval Done)', updatedAt: now, updatedBy: userId })
        .where(eq(vehicles.id, vehicleId));
    });
  }
}

// ─── Technician Acceptance / Rejection ───────────────────────────────────────
// Physical handover step after parts manager dispatch. Accept confirms the
// part is in the technician's hands; reject (with reason) bounces the
// request back to the parts manager queue so a replacement can be sourced.

export async function listPartsPendingAcceptance(request: FastifyRequest) {
  try {
    const userId = await resolveActorId(request);
    if (!userId) return error(HttpStatus.UNAUTHORIZED, "Not authenticated");

    // Show parts dispatched for jobs assigned to this technician (item-level
    // assignment). Falls back to all dispatched items if the technician is
    // a foreman/super-admin (they can also see and accept on behalf).
    const rows = await db
      .select({
        id: partRequests.id,
        jobCardId: partRequests.jobCardId,
        jobCardItemId: partRequests.jobCardItemId,
        vehicleId: partRequests.vehicleId,
        partName: partRequests.partName,
        partNumber: partRequests.partNumber,
        quantity: partRequests.quantity,
        status: partRequests.status,
        unitPrice: partRequests.unitPrice,
        updatedAt: partRequests.updatedAt,
        assignedTechnicianId: jobCardItems.assignedTechnicianId,
        jobDescription: jobCardItems.jobDescription,
        registrationNumber: vehicles.registrationNumber,
        vin: vehicles.vin,
        brand: vehicles.brand,
        model: vehicles.model,
      })
      .from(partRequests)
      .leftJoin(jobCardItems, eq(partRequests.jobCardItemId, jobCardItems.id))
      .leftJoin(vehicles, eq(partRequests.vehicleId, vehicles.id))
      .where(
        and(
          eq(partRequests.status, "dispatched"),
          // Strict: only show parts dispatched for job items assigned to
          // THIS technician. Unassigned items don't appear on anyone's
          // acceptance panel — the foreman must assign first.
          eq(jobCardItems.assignedTechnicianId, userId),
        ),
      );

    return success("OK", rows);
  } catch (err) {
    console.log("error :- ", err);
    return serverError(err);
  }
}

export async function acceptDispatchedPart(request: FastifyRequest) {
  try {
    const { partId } = request.params as any;
    const userId = await resolveActorId(request);
    if (!userId) return error(HttpStatus.UNAUTHORIZED, "Not authenticated");
    const now = new Date();

    const [part] = await db
      .select({ id: partRequests.id, status: partRequests.status })
      .from(partRequests)
      .where(eq(partRequests.id, partId))
      .limit(1);

    if (!part) return error(HttpStatus.NOT_FOUND, "Part request not found");
    if (part.status !== "dispatched") {
      return error(HttpStatus.BAD_REQUEST, `Only dispatched parts can be accepted. Current status: ${part.status}`);
    }

    await db
      .update(partRequests)
      .set({
        status: "accepted",
        acceptedAt: now,
        acceptedBy: userId,
        updatedBy: userId,
        updatedAt: now,
      })
      .where(eq(partRequests.id, partId));

    return success("Part accepted", { id: partId, status: "accepted" });
  } catch (err) {
    console.log("error :- ", err);
    return serverError(err);
  }
}

export async function rejectDispatchedPart(request: FastifyRequest) {
  try {
    const { partId } = request.params as any;
    const body = (request.body ?? {}) as { reason?: string };
    const reason = (body.reason ?? "").trim();
    if (!reason) {
      return error(HttpStatus.BAD_REQUEST, "Rejection reason is required");
    }

    const userId = await resolveActorId(request);
    if (!userId) return error(HttpStatus.UNAUTHORIZED, "Not authenticated");
    const now = new Date();

    const [part] = await db
      .select({ id: partRequests.id, status: partRequests.status })
      .from(partRequests)
      .where(eq(partRequests.id, partId))
      .limit(1);

    if (!part) return error(HttpStatus.NOT_FOUND, "Part request not found");
    if (part.status !== "dispatched") {
      return error(HttpStatus.BAD_REQUEST, `Only dispatched parts can be rejected. Current status: ${part.status}`);
    }

    // Rejection bounces the part back to 'pending' so the Parts Manager
    // sees it in the queue again with the rejection reason attached.
    await db
      .update(partRequests)
      .set({
        status: "pending",
        techRejectedAt: now,
        techRejectedBy: userId,
        rejectionReason: reason.slice(0, 500),
        updatedBy: userId,
        updatedAt: now,
      })
      .where(eq(partRequests.id, partId));

    return success("Part rejected — sent back to Parts Manager", { id: partId, status: "pending", reason });
  } catch (err) {
    console.log("error :- ", err);
    return serverError(err);
  }
}

