import { FastifyRequest } from 'fastify';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../../db';
import {
  vehicles,
  vehicleCheckIns,
  customers,
  customerContacts,
  jobCards,
  jobCardItems,
  partRequests,
} from '../../db/models';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── Get Estimate by Approval Token (Public) ────────────────────────────────
export async function getEstimateByToken(request: FastifyRequest) {
  try {
    const { token } = request.params as { token: string };

    if (!token || token.length !== 64) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid approval token');
    }

    // Fetch job card by approval token
    const [jobCard] = await db
      .select()
      .from(jobCards)
      .where(eq(jobCards.approvalToken, token))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Estimate not found or link has expired');
    }

    // Fetch job card items
    const items = await db
      .select()
      .from(jobCardItems)
      .where(eq(jobCardItems.jobCardId, jobCard.id))
      .orderBy(jobCardItems.sortOrder);

    // Fetch part requests for this job card and group by job_card_item_id.
    // An item can have multiple parts — surface the worst-case status
    // (unavailable > pending > available > dispatched) with the latest ETA.
    const parts = await db
      .select({
        jobCardItemId: partRequests.jobCardItemId,
        partName: partRequests.partName,
        partNumber: partRequests.partNumber,
        quantity: partRequests.quantity,
        status: partRequests.status,
        expectedTime: partRequests.expectedTime,
      })
      .from(partRequests)
      .where(eq(partRequests.jobCardId, jobCard.id));

    const STATUS_RANK: Record<string, number> = {
      unavailable: 3,
      pending: 2,
      available: 1,
      dispatched: 0,
    };
    const partsByItem = new Map<
      string,
      {
        status: string;
        expectedTime: string | null;
        parts: Array<{ partName: string; partNumber: string | null; quantity: number; status: string; expectedTime: string | null }>;
      }
    >();
    for (const p of parts) {
      const existing = partsByItem.get(p.jobCardItemId);
      const entry = existing ?? { status: p.status, expectedTime: p.expectedTime ?? null, parts: [] };
      entry.parts.push({
        partName: p.partName,
        partNumber: p.partNumber,
        quantity: p.quantity,
        status: p.status,
        expectedTime: p.expectedTime ?? null,
      });
      if ((STATUS_RANK[p.status] ?? 0) > (STATUS_RANK[entry.status] ?? 0)) {
        entry.status = p.status;
        entry.expectedTime = p.expectedTime ?? null;
      } else if (p.status === entry.status && p.expectedTime && !entry.expectedTime) {
        entry.expectedTime = p.expectedTime;
      }
      partsByItem.set(p.jobCardItemId, entry);
    }

    // Fetch vehicle details
    const [vehicle] = await db
      .select({
        id: vehicles.id,
        brand: vehicles.brand,
        model: vehicles.model,
        registrationNumber: vehicles.registrationNumber,
        customerId: vehicles.customerId,
      })
      .from(vehicles)
      .where(eq(vehicles.id, jobCard.vehicleId))
      .limit(1);

    // Fetch customer info
    let customerName = 'Customer';
    let customerPhone = '';
    if (vehicle?.customerId) {
      const [customer] = await db
        .select({
          firstName: customers.firstName,
          lastName: customers.lastName,
          companyName: customers.companyName,
        })
        .from(customers)
        .where(eq(customers.id, vehicle.customerId))
        .limit(1);

      if (customer) {
        customerName = customer.companyName
          || [customer.firstName, customer.lastName].filter(Boolean).join(' ')
          || 'Customer';
      }

      const [contact] = await db
        .select({
          countryCode: customerContacts.countryCode,
          contactNumber: customerContacts.contactNumber,
        })
        .from(customerContacts)
        .where(eq(customerContacts.customerId, vehicle.customerId))
        .limit(1);

      if (contact?.contactNumber) {
        customerPhone = `${contact.countryCode || '+27'} ${contact.contactNumber}`;
      }
    }

    // Compute supplementary-approval shape so the FE can render the right
    // view. Items with isApprovedByCustomer=null are the "new" lines added
    // since the previous approval (PM marked a tech-raised part Available);
    // items with =true are already-approved scope. =false means a previous
    // supplementary rejection (excluded from billing, audit-only).
    const itemsView = items.map((item: any) => {
      const partInfo = partsByItem.get(item.id) ?? null;
      return {
        id: item.id,
        jobDescription: item.jobDescription,
        partsRequired: item.partsRequired,
        partsCost: item.partsCost,
        labourCost: item.labourCost,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        // Preserve null so the FE can split into pending vs approved.
        isApprovedByCustomer: item.isApprovedByCustomer,
        partStatus: partInfo?.status ?? null,
        partExpectedTime: partInfo?.expectedTime ?? null,
        parts: partInfo?.parts ?? [],
      };
    });

    // Supplementary detection by timestamp — full approvals don't flip
    // is_approved_by_customer on each item, so we can't rely on that flag
    // alone to identify "new" supplementary lines. Instead: items created
    // AFTER jobCard.approvedAt are the supplementary additions (e.g. the
    // PM-added row for a tech-raised part); items created at-or-before
    // approvedAt are already-approved scope. Items explicitly marked
    // is_approved_by_customer = false are kept out of both buckets (they
    // were previously rejected).
    const approvedAtMs = jobCard.approvedAt ? new Date(jobCard.approvedAt as any).getTime() : null;
    const itemRowById = new Map(items.map((it: any) => [it.id, it]));

    // Tech-raised part requests link the PM-added job_card_items row via
    // supp_job_card_item_id. Any item referenced here is supplementary scope
    // regardless of whether the JC was previously approved — this covers the
    // "Jobs 1 & 2 still pending, customer approves the new Job 3 only" case.
    const suppLinks = await db
      .select({ itemId: partRequests.suppJobCardItemId })
      .from(partRequests)
      .where(and(eq(partRequests.jobCardId, jobCard.id), isNotNull(partRequests.suppJobCardItemId)));
    const suppLinkedIds = new Set(
      suppLinks.map((r: any) => r.itemId).filter((x: any): x is string => !!x),
    );

    const isSupp = (id: string): boolean => {
      const row: any = itemRowById.get(id);
      if (!row) return false;
      if (row.isApprovedByCustomer === false) return false; // previously rejected, exclude
      if (row.isApprovedByCustomer === true) return false;  // already approved in a prior round
      if (suppLinkedIds.has(id)) return true;               // PM-added supplementary item
      if (approvedAtMs == null) return false;               // never approved → INITIAL flow
      const createdMs = new Date(row.createdAt as any).getTime();
      return createdMs > approvedAtMs;                       // created after the prior approval
    };

    const pendingItems  = itemsView.filter((i) => isSupp(i.id));
    const approvedItems = itemsView.filter((i) => !isSupp(i.id) && i.isApprovedByCustomer !== false);
    const sumLine = (arr: typeof itemsView) =>
      arr.reduce((s, i) => s + Number(i.lineTotal ?? 0), 0);

    // INITIAL = first-ever share (no prior approvedAt) OR a customer-
    //           requested modification with no new items added.
    // SUPPLEMENTARY = at least one item created after the prior approval.
    const approvalMode: 'INITIAL' | 'SUPPLEMENTARY' =
      pendingItems.length > 0 && approvedItems.length > 0
        ? 'SUPPLEMENTARY'
        : 'INITIAL';

    const taxPct = Number(jobCard.taxPercentage ?? 0);
    const priorApprovedSubtotal = sumLine(approvedItems);
    const additionalSubtotal    = sumLine(pendingItems);
    const additionalTaxAmount   = (additionalSubtotal * taxPct) / 100;
    const priorApprovedTax      = (priorApprovedSubtotal * taxPct) / 100;
    const priorApprovedTotal    = priorApprovedSubtotal + priorApprovedTax;
    const newTotal              = priorApprovedTotal + additionalSubtotal + additionalTaxAmount;

    return success('Estimate fetched successfully', {
      jobCard: {
        id: jobCard.id,
        status: jobCard.status,
        subtotal: jobCard.subtotal,
        taxLabel: jobCard.taxLabel,
        taxPercentage: jobCard.taxPercentage,
        taxAmount: jobCard.taxAmount,
        totalEstimate: jobCard.totalEstimate,
        sharedAt: jobCard.sharedAt,
        approvedAt: jobCard.approvedAt,
        currencyCode: jobCard.currencyCode || 'ZAR',
        modificationNote: jobCard.modificationNote ?? null,
      },
      items: itemsView,
      // Supplementary-mode derived fields. The FE checks approvalMode and
      // either renders the existing full-estimate view (INITIAL) or the
      // new "only new items" view (SUPPLEMENTARY).
      approvalMode,
      pendingItems,
      approvedItems,
      priorApprovedSubtotal: priorApprovedSubtotal.toFixed(2),
      priorApprovedTax:      priorApprovedTax.toFixed(2),
      priorApprovedTotal:    priorApprovedTotal.toFixed(2),
      additionalSubtotal:    additionalSubtotal.toFixed(2),
      additionalTaxAmount:   additionalTaxAmount.toFixed(2),
      newTotal:              newTotal.toFixed(2),
      vehicle: vehicle
        ? {
            brand: vehicle.brand,
            model: vehicle.model,
            registrationNumber: vehicle.registrationNumber,
          }
        : null,
      customerName,
      customerPhone,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Approve Estimate by Token (Public) ──────────────────────────────────────
export async function approveEstimateByToken(request: FastifyRequest) {
  try {
    const { token } = request.params as { token: string };
    const body = (request.body as { approvedItems?: string[] }) ?? {};

    if (!token || token.length !== 64) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid approval token');
    }

    const [jobCard] = await db
      .select({ id: jobCards.id, status: jobCards.status, vehicleId: jobCards.vehicleId })
      .from(jobCards)
      .where(eq(jobCards.approvalToken, token))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Estimate not found or link has expired');
    }

    // SHARED = original estimate awaiting first approval.
    // MODIFICATION_REQUESTED = supplementary approval after a tech-raised
    // part was priced by the PM (markAvailable bumped the totals + re-shared).
    if (jobCard.status !== 'SHARED' && jobCard.status !== 'MODIFICATION_REQUESTED') {
      return error(
        HttpStatus.BAD_REQUEST,
        jobCard.status === 'APPROVED' || jobCard.status === 'PARTIALLY_APPROVED'
          ? 'This estimate has already been approved'
          : `This estimate cannot be approved. Current status: ${jobCard.status}`,
      );
    }

    const now = new Date();

    // Get all items for this job card with their created_at so we can tell
    // pre-existing items from supplementary additions (items created AFTER
    // the prior jobCard.approvedAt).
    const allItems = await db
      .select({ id: jobCardItems.id, createdAt: jobCardItems.createdAt, isApproved: jobCardItems.isApprovedByCustomer })
      .from(jobCardItems)
      .where(eq(jobCardItems.jobCardId, jobCard.id));

    const allItemIds = allItems.map((i: any) => i.id);
    const approvedItemIds = body.approvedItems;

    // Supplementary detection — same rule as getEstimateByToken: if this
    // job card was approved before, any item created after that approval
    // is a supplementary addition (PM-priced tech-raised part). The
    // approvedItems[] array from the FE only refers to supplementary items
    // in that case — pre-existing items keep their prior approval.
    const [jcFull] = await db
      .select({ approvedAt: jobCards.approvedAt })
      .from(jobCards)
      .where(eq(jobCards.id, jobCard.id))
      .limit(1);
    const priorApprovedAtMs = jcFull?.approvedAt ? new Date(jcFull.approvedAt as any).getTime() : null;

    // Tech-raised PM-added items linked via part_requests.supp_job_card_item_id
    // are supplementary scope. Treat any approval round that touches only
    // these as a supplementary round — covers both (a) classic supplementary
    // (JC was approved before) and (b) tech raised a part while the JC was
    // still pending its first approval (Job 1+2 pending, Job 3 new and PM-added).
    const suppLinkRows = await db
      .select({ itemId: partRequests.suppJobCardItemId })
      .from(partRequests)
      .where(and(eq(partRequests.jobCardId, jobCard.id), isNotNull(partRequests.suppJobCardItemId)));
    const suppLinkedIds = new Set(
      suppLinkRows.map((r: any) => r.itemId).filter((x: any): x is string => !!x),
    );
    const approvedIsAllSupp =
      !!approvedItemIds &&
      approvedItemIds.length > 0 &&
      approvedItemIds.every((id) => suppLinkedIds.has(id));
    const isSupplementaryRound =
      (priorApprovedAtMs != null && jobCard.status === 'MODIFICATION_REQUESTED') ||
      approvedIsAllSupp;

    let jobCardStatus: 'APPROVED' | 'PARTIALLY_APPROVED' | 'PENDING_CUSTOMER_APPROVAL';
    let vehicleStatus: string;
    let isPartial = false;

    if (isSupplementaryRound) {
      // The "scope" for this round is only the supplementary items. Approving
      // them shouldn't flip pre-existing items to rejected. If the original
      // items haven't been approved yet either, leave the JC at its previous
      // status (no PARTIALLY_APPROVED noise from a scoped supp round).
      const originalsAllApproved = allItems
        .filter((it: any) => !suppLinkedIds.has(it.id))
        .every((it: any) => it.isApproved === true);
      jobCardStatus = originalsAllApproved
        ? 'APPROVED'
        : (jobCard.status as any) || 'PENDING_CUSTOMER_APPROVAL';
      vehicleStatus = originalsAllApproved
        ? 'Job Card (Full Cust. Approval)'
        : 'Job Card (Pending Cust. Approval)';
    } else {
      isPartial = !!(approvedItemIds && approvedItemIds.length > 0 && approvedItemIds.length < allItemIds.length);
      jobCardStatus = isPartial ? 'PARTIALLY_APPROVED' : 'APPROVED';
      vehicleStatus = isPartial ? 'Job Card (Partial Cust. Approval)' : 'Job Card (Full Cust. Approval)';
    }

    await db.transaction(async (tx: any) => {
      // approvedAt: only set on a non-supp round, since supp approvals are
      // scoped and shouldn't claim the whole JC was approved at this moment.
      const jcUpdate: any = { status: jobCardStatus as any, updatedAt: now, acceptanceChannel: 'CUSTOMER_LINK' };
      if (!isSupplementaryRound) jcUpdate.approvedAt = now;
      await tx
        .update(jobCards)
        .set(jcUpdate)
        .where(eq(jobCards.id, jobCard.id));

      // For supplementary rounds, ONLY the supp items get their flag flipped
      // — pre-existing items keep whatever flag they had.
      if (isSupplementaryRound) {
        const idsToFlip = (approvedItemIds ?? []).filter((id) => suppLinkedIds.has(id));
        if (idsToFlip.length > 0) {
          await tx
            .update(jobCardItems)
            .set({ isApprovedByCustomer: true, updatedAt: now })
            .where(inArray(jobCardItems.id, idsToFlip));
        }
      } else if (isPartial && approvedItemIds) {
        // Original-share partial approval (unchanged).
        const rejectedItemIds = allItemIds.filter((id: any) => !approvedItemIds.includes(id));
        if (rejectedItemIds.length > 0) {
          await tx
            .update(jobCardItems)
            .set({ isApprovedByCustomer: false, updatedAt: now })
            .where(inArray(jobCardItems.id, rejectedItemIds));
        }
        // Ensure approved items are marked true
        await tx
          .update(jobCardItems)
          .set({ isApprovedByCustomer: true, updatedAt: now })
          .where(inArray(jobCardItems.id, approvedItemIds));
      }

      await tx
        .update(vehicles)
        .set({ status: vehicleStatus, updatedAt: now })
        .where(eq(vehicles.id, jobCard.vehicleId));

      // Pull each pending tech-raised part_request so we can auto-assign
      // the supplementary jobCardItems row back to the tech who raised
      // it — no SA handoff, no foreman re-allocation. The tech is already
      // on the vehicle and will see the new line in their queue on next
      // dashboard refresh.
      const pendingSupp = await tx
        .select({
          id: partRequests.id,
          requestedBy: partRequests.requestedBy,
          suppJobCardItemId: partRequests.suppJobCardItemId,
        })
        .from(partRequests)
        .where(and(
          eq(partRequests.jobCardId, jobCard.id),
          eq(partRequests.customerApprovalStatus, 'PENDING'),
        ));

      // Flip status first so the technician's completeItemWork guard
      // unblocks immediately on the parent item.
      await tx
        .update(partRequests)
        .set({ customerApprovalStatus: 'APPROVED', approvedAt: now, updatedAt: now })
        .where(and(
          eq(partRequests.jobCardId, jobCard.id),
          eq(partRequests.customerApprovalStatus, 'PENDING'),
        ));

      // Auto-assign each supplementary item to the original requester.
      for (const pr of pendingSupp) {
        if (pr.suppJobCardItemId && pr.requestedBy) {
          await tx
            .update(jobCardItems)
            .set({
              assignedTechnicianId: pr.requestedBy,
              assignedAt: now,
              assignedBy: null,                  // self-assigned via the request flow
              isApprovedByCustomer: true,        // matches the parent JC approval
              updatedAt: now,
            })
            .where(eq(jobCardItems.id, pr.suppJobCardItemId));
        }
      }

      // Note: the active check-in is intentionally NOT closed here. Previously
      // it was — back when "customer approved" was the terminal step — but the
      // technician-assignment flow now happens AFTER approval. Closing the
      // check-in here would orphan the approved job card from the visit, hide
      // it from getVehicleJobCards (which scopes to the active visit), and
      // prevent the service advisor from clicking "Assign Technician". The
      // check-in will be closed later when the technician marks work complete.
    });

    // Phase 4 — staff broadcast on full approval (SA + Parts + Foreman +
    // Controllers receive an in-app notification + email to the SA). Fire
    // and forget; the dispatcher swallows its own errors.
    if (!isPartial) {
      try {
        const [active] = await db
          .select({ id: vehicleCheckIns.id })
          .from(vehicleCheckIns)
          .where(and(eq(vehicleCheckIns.vehicleId, jobCard.vehicleId), eq(vehicleCheckIns.isActive, true)))
          .limit(1);
        if (active) {
          const mod = await import('../notifications/service');
          await mod.dispatchNotifications({
            trigger: 'APPROVAL',
            triggerValue: 'APPROVED',
            checkInId: active.id,
          });
        }
      } catch (err) {
        console.error('[customer-approval] notification dispatch failed:', err);
      }
    }

    return success(isPartial ? 'Estimate partially approved' : 'Estimate approved successfully', {
      jobCardId: jobCard.id,
      status: jobCardStatus,
      approvedAt: now.toISOString(),
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Request Modification by Token (Public) ──────────────────────────────────
export async function requestModificationByToken(request: FastifyRequest) {
  try {
    const { token } = request.params as { token: string };
    const { note } = (request.body as { note?: string }) ?? {};

    if (!token || token.length !== 64) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid approval token');
    }

    const [jobCard] = await db
      .select({ id: jobCards.id, status: jobCards.status, vehicleId: jobCards.vehicleId })
      .from(jobCards)
      .where(eq(jobCards.approvalToken, token))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Estimate not found or link has expired');
    }

    if (jobCard.status !== 'SHARED') {
      return error(
        HttpStatus.BAD_REQUEST,
        jobCard.status === 'MODIFICATION_REQUESTED'
          ? 'A modification request has already been submitted'
          : `This estimate cannot be modified. Current status: ${jobCard.status}`,
      );
    }

    const now = new Date();

    await db
      .update(jobCards)
      .set({ status: 'MODIFICATION_REQUESTED', modificationNote: note || null, updatedAt: now })
      .where(eq(jobCards.id, jobCard.id));

    return success('Modification request submitted', {
      jobCardId: jobCard.id,
      status: 'MODIFICATION_REQUESTED',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Reject Estimate by Token (Public) ───────────────────────────────────────
export async function rejectEstimateByToken(request: FastifyRequest) {
  try {
    const { token } = request.params as { token: string };

    if (!token || token.length !== 64) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid approval token');
    }

    const [jobCard] = await db
      .select({ id: jobCards.id, status: jobCards.status, vehicleId: jobCards.vehicleId })
      .from(jobCards)
      .where(eq(jobCards.approvalToken, token))
      .limit(1);

    if (!jobCard) {
      return error(HttpStatus.NOT_FOUND, 'Estimate not found or link has expired');
    }

    if (jobCard.status !== 'SHARED' && jobCard.status !== 'MODIFICATION_REQUESTED') {
      return error(
        HttpStatus.BAD_REQUEST,
        jobCard.status === 'REJECTED'
          ? 'This estimate has already been rejected'
          : `This estimate cannot be rejected. Current status: ${jobCard.status}`,
      );
    }

    const now = new Date();

    // Supplementary path: customer rejects the extra part. Mark each
    // PENDING part_request as REJECTED, recalc job-card totals from the
    // remaining (original) line items, and return the job card to
    // APPROVED so the original work continues uninterrupted. The
    // supplementary jobCardItems row stays in place but flagged as
    // isApprovedByCustomer=false so it shows in history but is excluded
    // from invoicing (Phase 7 already filters on isApprovedByCustomer).
    if (jobCard.status === 'MODIFICATION_REQUESTED') {
      const pending = await db
        .select({
          id: partRequests.id,
          unitPrice: partRequests.unitPrice,
          extraLabourCost: partRequests.extraLabourCost,
          quantity: partRequests.quantity,
          partName: partRequests.partName,
          partNumber: partRequests.partNumber,
        })
        .from(partRequests)
        .where(and(
          eq(partRequests.jobCardId, jobCard.id),
          eq(partRequests.customerApprovalStatus, 'PENDING'),
        ));

      await db.transaction(async (tx: any) => {
        let totalToRevert = 0;
        for (const pr of pending) {
          const unit = Number(pr.unitPrice ?? 0);
          const labour = Number(pr.extraLabourCost ?? 0);
          totalToRevert += unit * pr.quantity + labour;

          // Mark the supplementary jobCardItems row (matched by description
          // + parts_required + zero completion) as customer-rejected. This
          // keeps the row in audit history but excludes it from invoicing.
          await tx
            .update(jobCardItems)
            .set({ isApprovedByCustomer: false, updatedAt: now })
            .where(and(
              eq(jobCardItems.jobCardId, jobCard.id),
              eq(jobCardItems.jobDescription, pr.partName),
            ));

          await tx
            .update(partRequests)
            .set({ customerApprovalStatus: 'REJECTED', rejectedAt: now, updatedAt: now })
            .where(eq(partRequests.id, pr.id));
        }

        const [jcRow] = await tx
          .select({ subtotal: jobCards.subtotal, taxPercentage: jobCards.taxPercentage })
          .from(jobCards).where(eq(jobCards.id, jobCard.id)).limit(1);
        if (jcRow) {
          const newSubtotal = Math.max(0, Number(jcRow.subtotal ?? 0) - totalToRevert);
          const taxPct = Number(jcRow.taxPercentage ?? 0);
          const newTax = (newSubtotal * taxPct) / 100;
          await tx
            .update(jobCards)
            .set({
              subtotal: newSubtotal.toFixed(2),
              taxAmount: newTax.toFixed(2),
              totalEstimate: (newSubtotal + newTax).toFixed(2),
              status: 'APPROVED',
              modificationNote: 'Customer rejected supplementary part — reverted to original scope.',
              updatedAt: now,
            })
            .where(eq(jobCards.id, jobCard.id));
        }
      });

      return success('Supplementary cost rejected — original scope preserved', {
        jobCardId: jobCard.id,
        status: 'APPROVED',
      });
    }

    // Original-estimate reject path (unchanged).
    await db
      .update(jobCards)
      .set({ status: 'REJECTED', updatedAt: now })
      .where(eq(jobCards.id, jobCard.id));

    return success('Estimate rejected', {
      jobCardId: jobCard.id,
      status: 'REJECTED',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
