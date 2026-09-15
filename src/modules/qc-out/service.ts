import { FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, sql, count } from 'drizzle-orm';
import { db } from '../../db';
import {
  vehicleCheckIns,
  vehicles,
  customers,
  qcOutInspections,
  qcOutInspectionItems,
  qcOutInspectionPhotos,
  qcOutWorkVerifications,
  qcOutChecklist,
  qcInspections,
  qcInspectionItems,
  jobCards,
  jobCardItems,
  jobCardItemPhotos,
  users,
} from '../../db/models';
import { isNotNull } from 'drizzle-orm';
import { resolveUserScope, shopFilter, checkInInScope } from '../../shared/security/scope';

// Shop-scope guard for single check-in reads (R3). True (allowed) for
// super-admin / ALL. Used by the qc-out single-record helpers below.
async function checkInShopAllowed(request: FastifyRequest, checkInId: string): Promise<boolean> {
  const scope = await resolveUserScope(request);
  const [ci] = await db
    .select({ shop: vehicleCheckIns.shop })
    .from(vehicleCheckIns)
    .where(eq(vehicleCheckIns.id, checkInId))
    .limit(1);
  return checkInInScope(scope, (ci?.shop as any) ?? null);
}
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { setRoStatus } from '../../shared/utils/roStatus';
import { handleSingleFileUpload } from '../../shared/upload/upload';

// ─── List: Awaiting QC Out + recent decisions ──────────────────────────────
export async function getDashboard(request: FastifyRequest) {
  try {
    const q = (request.query ?? {}) as {
      page?: string | number;
      limit?: string | number;
      recentPage?: string | number;
      recentLimit?: string | number;
    };
    const paginated = q.page != null || q.limit != null || q.recentPage != null || q.recentLimit != null;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;
    const recentPage = Number(q.recentPage) || 1;
    const recentLimit = Number(q.recentLimit) || 10;
    const recentOffset = (recentPage - 1) * recentLimit;

    // Shop scoping (no-op for super-admin / ALL).
    const scope = await resolveUserScope(request);

    const awaitingWhere = and(eq(vehicleCheckIns.isActive, true), eq(vehicleCheckIns.roStatus, 'QC_OUT'), shopFilter(scope));

    const [{ awaitingTotal }] = await db
      .select({ awaitingTotal: count() })
      .from(vehicleCheckIns)
      .where(awaitingWhere);

    const awaitingBase = db
      .select({
        checkInId: vehicleCheckIns.id,
        roStatus: vehicleCheckIns.roStatus,
        roStatusAt: vehicleCheckIns.roStatusAt,
        vehicleId: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        receivingNo: vehicleCheckIns.receivingNo,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicles.id, vehicleCheckIns.vehicleId))
      .leftJoin(customers, eq(customers.id, vehicles.customerId))
      .where(awaitingWhere)
      .orderBy(asc(vehicleCheckIns.roStatusAt));

    const awaiting = paginated
      ? await awaitingBase.limit(limit).offset(offset)
      : await awaitingBase;

    const [{ recentTotal }] = await db
      .select({ recentTotal: count() })
      .from(qcOutInspections);

    const recentBase = db
      .select({
        id: qcOutInspections.id,
        checkInId: qcOutInspections.checkInId,
        overallStatus: qcOutInspections.overallStatus,
        finalRemarks: qcOutInspections.finalRemarks,
        completedAt: qcOutInspections.completedAt,
        inspectorId: qcOutInspections.inspectorId,
        inspectorName: users.username,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
      })
      .from(qcOutInspections)
      .innerJoin(vehicleCheckIns, eq(vehicleCheckIns.id, qcOutInspections.checkInId))
      .innerJoin(vehicles, eq(vehicles.id, vehicleCheckIns.vehicleId))
      .leftJoin(users, eq(users.id, qcOutInspections.inspectorId))
      .where(shopFilter(scope))
      .orderBy(desc(qcOutInspections.completedAt));

    const recent = paginated
      ? await recentBase.limit(recentLimit).offset(recentOffset)
      : await recentBase.limit(20);

    const items = awaiting.map((r) => ({
      ...r,
      customerName: `${r.customerFirstName ?? ''} ${r.customerLastName ?? ''}`.trim() || null,
    }));

    if (!paginated) {
      return success('QC Out dashboard fetched', { awaiting: items, recent });
    }

    const totalNum = Number(awaitingTotal) || 0;
    const recentTotalNum = Number(recentTotal) || 0;
    return success('QC Out dashboard fetched', {
      awaiting: items,
      recent,
      pagination: {
        page,
        limit,
        total: totalNum,
        totalPages: Math.max(1, Math.ceil(totalNum / limit)),
      },
      recentPagination: {
        page: recentPage,
        limit: recentLimit,
        total: recentTotalNum,
        totalPages: Math.max(1, Math.ceil(recentTotalNum / recentLimit)),
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Checklist master ─────────────────────────────────────────────────────
export async function getChecklist(_request: FastifyRequest) {
  try {
    const rows = await db
      .select()
      .from(qcOutChecklist)
      .where(eq(qcOutChecklist.isActive, true))
      .orderBy(asc(qcOutChecklist.sortOrder));
    return success('Checklist fetched', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get inspection by check-in (returns latest) ──────────────────────────
export async function getLatestForCheckIn(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    if (!(await checkInShopAllowed(request, checkInId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }
    const [insp] = await db
      .select()
      .from(qcOutInspections)
      .where(eq(qcOutInspections.checkInId, checkInId))
      .orderBy(desc(qcOutInspections.completedAt))
      .limit(1);
    if (!insp) return success('No inspection yet', null);

    const items = await db
      .select()
      .from(qcOutInspectionItems)
      .where(eq(qcOutInspectionItems.inspectionId, insp.id))
      .orderBy(asc(qcOutInspectionItems.sortOrder));
    const photos = await db
      .select()
      .from(qcOutInspectionPhotos)
      .where(eq(qcOutInspectionPhotos.inspectionId, insp.id));

    return success('Inspection fetched', { ...insp, items, photos });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Submit decision ──────────────────────────────────────────────────────
// Single chokepoint: validates payload, writes inspection + items + photos
// in one transaction, then advances ro_status. On PASS we make two
// transitions back-to-back (QC_PASSED → WASHBAY) so the customer gets both
// WhatsApp templates and the FE can pick the vehicle up under Washbay
// immediately.
type SubmitBody = {
  overallStatus: 'PASS' | 'FAIL';
  finalRemarks?: string;
  signatureImageUrl?: string;            // pre-uploaded S3 key (optional)
  items: Array<{
    itemLabel: string;
    status: 'PASS' | 'FAIL' | 'NA';
    notes?: string;
    sortOrder?: number;
    photoUrls?: string[];                // S3 keys for FAIL evidence
    // Phase 9 — 3.10 parity with QC In. Optional but recommended so the
    // comparison endpoint can join row-by-row to detect workshop damage.
    category?: string;
    subCategory?: string;
    itemCode?: string;
    qcInItemId?: string;
  }>;
  // Works Completed verifications — one entry per completed job-card item
  // the inspector ticked off. Every completed item MUST be in this list.
  works?: Array<{
    jobCardItemId: string;
    result: 'PASS' | 'FAIL' | 'NA';
    notes?: string;
  }>;
};

export async function submitInspection(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    const body = request.body as SubmitBody;
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    if (!body?.overallStatus || (body.overallStatus !== 'PASS' && body.overallStatus !== 'FAIL')) {
      return error(HttpStatus.BAD_REQUEST, 'overallStatus must be PASS or FAIL');
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return error(HttpStatus.BAD_REQUEST, 'items must be a non-empty array');
    }

    // Enforce: every FAIL item must have at least one photo.
    for (const it of body.items) {
      if (it.status === 'FAIL' && (!it.photoUrls || it.photoUrls.length === 0)) {
        return error(
          HttpStatus.BAD_REQUEST,
          `"${it.itemLabel}" failed — at least one photo evidence is required.`,
        );
      }
    }

    // Works Completed gate: pull the canonical list of completed job-card
    // items for this check-in. Every one must appear in body.works with a
    // result. Inspector cannot sign out without verifying each completed
    // repair. A FAIL on any work flips the whole inspection to FAIL.
    const completedItems = await db
      .select({ id: jobCardItems.id, jobDescription: jobCardItems.jobDescription })
      .from(jobCardItems)
      .innerJoin(jobCards, eq(jobCards.id, jobCardItems.jobCardId))
      .where(and(
        eq(jobCards.vehicleCheckInId, checkInId),
        isNotNull(jobCardItems.completedAt),
      ));
    const completedIds = new Set(completedItems.map((i) => i.id));
    const works = body.works ?? [];
    const worksById = new Map(works.map((w) => [w.jobCardItemId, w]));

    for (const ci of completedItems) {
      const w = worksById.get(ci.id);
      if (!w || !w.result) {
        return error(
          HttpStatus.BAD_REQUEST,
          `Work "${ci.jobDescription}" must be verified (PASS / FAIL / NA) before signing out.`,
        );
      }
    }
    // Reject any unknown jobCardItemId (not actually on this visit).
    for (const w of works) {
      if (!completedIds.has(w.jobCardItemId)) {
        return error(HttpStatus.BAD_REQUEST, 'Unknown work item in submission');
      }
    }
    // If any work failed, the overall inspection must also be FAIL.
    const anyWorkFailed = works.some((w) => w.result === 'FAIL');
    if (anyWorkFailed && body.overallStatus !== 'FAIL') {
      return error(
        HttpStatus.BAD_REQUEST,
        'A work was marked FAIL — overall status must be FAIL.',
      );
    }

    // Confirm the check-in exists and is in a valid pre-decision state.
    const [chk] = await db
      .select({ id: vehicleCheckIns.id, roStatus: vehicleCheckIns.roStatus })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);
    if (!chk) return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    if (chk.roStatus !== 'QC_OUT') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Check-in is not at QC_OUT (current: ${chk.roStatus}). Refresh and try again.`,
      );
    }

    const now = new Date();
    const [insp] = await db.transaction(async (tx: any) => {
      const inserted = await tx
        .insert(qcOutInspections)
        .values({
          checkInId,
          overallStatus: body.overallStatus,
          finalRemarks: body.finalRemarks?.trim() || null,
          inspectorId: actorId,
          signatureImageUrl: body.signatureImageUrl ?? null,
          startedAt: now,
          completedAt: now,
        })
        .returning();
      const inspectionId = inserted[0].id;

      const itemRows = body.items.map((it, idx) => ({
        inspectionId,
        category: (it.category ?? null) as any,
        subCategory: it.subCategory ?? null,
        itemCode: it.itemCode ?? null,
        itemLabel: it.itemLabel,
        qcInItemId: it.qcInItemId ?? null,
        status: it.status,
        notes: it.notes?.trim() || null,
        sortOrder: it.sortOrder ?? idx,
      }));
      const itemsInserted = await tx.insert(qcOutInspectionItems).values(itemRows).returning();

      // Attach photos to their matched item. FE submits photoUrls per item;
      // we match them by index against itemsInserted (same order).
      const photoValues: { inspectionId: string; itemId: string; imageUrl: string; takenBy: string }[] = [];
      body.items.forEach((it, idx) => {
        (it.photoUrls ?? []).forEach((url) => {
          photoValues.push({
            inspectionId,
            itemId: itemsInserted[idx].id,
            imageUrl: url,
            takenBy: actorId,
          });
        });
      });
      if (photoValues.length > 0) {
        await tx.insert(qcOutInspectionPhotos).values(photoValues);
      }

      // Insert one work_verification row per completed item the inspector
      // verified. Drives the QC-fail rework loop when result === 'FAIL'.
      if (works.length > 0) {
        await tx.insert(qcOutWorkVerifications).values(
          works.map((w) => ({
            qcOutInspectionId: inspectionId,
            checkInId,
            jobCardItemId: w.jobCardItemId,
            result: w.result,
            notes: w.notes?.trim() || null,
            verifiedAt: now,
            verifiedBy: actorId,
          })),
        );
      }

      return inserted;
    });

    // Advance RO status. PASS chains QC_PASSED → WASHBAY; FAIL ends at
    // QC_FAILED so the Foreman can re-allocate. setRoStatus fires the
    // Phase 4 notification rules and (for PASS) auto-releases the bay.
    if (body.overallStatus === 'PASS') {
      await setRoStatus(checkInId, 'QC_PASSED', actorId, 'QC Out passed');
      await setRoStatus(checkInId, 'WASHBAY',   actorId, 'Moved to washbay');
    } else {
      await setRoStatus(checkInId, 'QC_FAILED', actorId, 'QC Out failed');
    }

    return created(`QC Out submitted — ${body.overallStatus}`, {
      inspectionId: insp.id,
      overallStatus: insp.overallStatus,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Upload a single photo (returns its S3 key for the submit payload) ────
export async function uploadInspectionPhoto(request: FastifyRequest) {
  try {
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    const { file } = await handleSingleFileUpload(request);
    return success('Photo uploaded', { imageUrl: file.path });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Works Completed — list completed job-card items for QC verification ──
// Pulls every job-card item on the active check-in that has completedAt set,
// joined with technician + the repair photos the tech uploaded. Inspector
// uses this to tick each work PASS/FAIL/NA before signing the vehicle out.
export async function getCompletedWorks(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    if (!(await checkInShopAllowed(request, checkInId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const items = await db
      .select({
        id: jobCardItems.id,
        jobCardId: jobCardItems.jobCardId,
        jobDescription: jobCardItems.jobDescription,
        partsRequired: jobCardItems.partsRequired,
        completedAt: jobCardItems.completedAt,
        completedBy: jobCardItems.completedBy,
        completionNotes: jobCardItems.completionNotes,
        isWarrantyClaim: jobCardItems.isWarrantyClaim,
        warrantyClaimNo: jobCardItems.warrantyClaimNo,
        technicianName: users.username,
      })
      .from(jobCardItems)
      .innerJoin(jobCards, eq(jobCards.id, jobCardItems.jobCardId))
      .leftJoin(users, eq(users.id, jobCardItems.completedBy))
      .where(and(
        eq(jobCards.vehicleCheckInId, checkInId),
        isNotNull(jobCardItems.completedAt),
      ))
      .orderBy(asc(jobCardItems.sortOrder));

    const itemIds = items.map((i) => i.id);
    const repairPhotos = itemIds.length
      ? await db
          .select({
            jobCardItemId: jobCardItemPhotos.jobCardItemId,
            imageUrl: jobCardItemPhotos.imageUrl,
          })
          .from(jobCardItemPhotos)
          .where(and(
            inArray(jobCardItemPhotos.jobCardItemId, itemIds),
            eq(jobCardItemPhotos.photoType, 'REPAIR'),
          ))
      : [];

    const photosByItem: Record<string, string[]> = {};
    for (const p of repairPhotos) {
      const arr = photosByItem[p.jobCardItemId] ?? [];
      arr.push(p.imageUrl);
      photosByItem[p.jobCardItemId] = arr;
    }

    return success('Completed works fetched', items.map((it) => ({
      ...it,
      repairPhotos: photosByItem[it.id] ?? [],
    })));
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Rework hints — failed works from the latest QC-out attempt ───────────
// Used by the Foreman dashboard + AllocateBayModal when a vehicle is at
// QC_FAILED — surfaces the exact items the inspector flagged so the foreman
// can brief the technician and tag the right bay for rework.
export async function getFailedWorks(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    if (!(await checkInShopAllowed(request, checkInId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    const [latest] = await db
      .select({ id: qcOutInspections.id, status: qcOutInspections.overallStatus, completedAt: qcOutInspections.completedAt })
      .from(qcOutInspections)
      .where(eq(qcOutInspections.checkInId, checkInId))
      .orderBy(desc(qcOutInspections.completedAt))
      .limit(1);
    if (!latest) return success('No prior QC-out attempt', { inspectionId: null, status: null, failedWorks: [] });

    const rows = await db
      .select({
        id: qcOutWorkVerifications.id,
        jobCardItemId: qcOutWorkVerifications.jobCardItemId,
        notes: qcOutWorkVerifications.notes,
        verifiedAt: qcOutWorkVerifications.verifiedAt,
        jobDescription: jobCardItems.jobDescription,
        partsRequired: jobCardItems.partsRequired,
        completedBy: jobCardItems.completedBy,
        technicianName: users.username,
      })
      .from(qcOutWorkVerifications)
      .innerJoin(jobCardItems, eq(jobCardItems.id, qcOutWorkVerifications.jobCardItemId))
      .leftJoin(users, eq(users.id, jobCardItems.completedBy))
      .where(and(
        eq(qcOutWorkVerifications.qcOutInspectionId, latest.id),
        eq(qcOutWorkVerifications.result, 'FAIL'),
      ));

    return success('Failed works fetched', {
      inspectionId: latest.id,
      status: latest.status,
      completedAt: latest.completedAt,
      failedWorks: rows,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

void isNotNull;
// Silence the unused-import warning for inArray + sql.
void inArray; void sql;

// ─── Phase 9 — 3.10 QC In ↔ QC Out checklist parity ──────────────────────────

// Returns the QC In items for this check-in. QC Out can use this list as the
// "template" — same items, technician records pass/fail, comparison flags
// any item that was PASS at entry but FAIL at exit as workshop damage.
export async function getQcInItemsForCheckIn(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    if (!(await checkInShopAllowed(request, checkInId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    // Find the latest COMPLETED QC In inspection for this check-in.
    const [insp] = await db
      .select({ id: qcInspections.id })
      .from(qcInspections)
      .where(and(eq(qcInspections.vehicleCheckInId, checkInId), eq(qcInspections.status, 'COMPLETED' as any)))
      .orderBy(desc(qcInspections.completedAt))
      .limit(1);

    if (!insp) {
      // QC In not yet done — QC Out can't run; return empty so FE shows a hint.
      return success('No completed QC In for this check-in', { items: [] });
    }

    const items = await db
      .select({
        id: qcInspectionItems.id,
        category: qcInspectionItems.category,
        subCategory: qcInspectionItems.subCategory,
        itemCode: qcInspectionItems.itemCode,
        itemLabel: qcInspectionItems.itemLabel,
        sortOrder: qcInspectionItems.sortOrder,
        qcInResult: qcInspectionItems.result,
        qcInComment: qcInspectionItems.comment,
      })
      .from(qcInspectionItems)
      .where(eq(qcInspectionItems.inspectionId, insp.id))
      .orderBy(asc(qcInspectionItems.sortOrder));

    return success('OK', { qcInInspectionId: insp.id, items });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Comparison view: returns the latest QC In's items joined with the latest
// QC Out's items so the dashboard can highlight regressions ("workshop
// damage"). PASS at In + FAIL at Out → damage flag.
export async function getComparison(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    if (!(await checkInShopAllowed(request, checkInId))) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }

    // Latest COMPLETED QC In + latest QC Out inspection.
    const [qcIn] = await db
      .select({ id: qcInspections.id })
      .from(qcInspections)
      .where(and(eq(qcInspections.vehicleCheckInId, checkInId), eq(qcInspections.status, 'COMPLETED' as any)))
      .orderBy(desc(qcInspections.completedAt))
      .limit(1);

    const [qcOut] = await db
      .select({ id: qcOutInspections.id, overallStatus: qcOutInspections.overallStatus })
      .from(qcOutInspections)
      .where(eq(qcOutInspections.checkInId, checkInId))
      .orderBy(desc(qcOutInspections.completedAt))
      .limit(1);

    if (!qcIn || !qcOut) {
      return success('Comparison not yet available', {
        qcInInspectionId: qcIn?.id ?? null,
        qcOutInspectionId: qcOut?.id ?? null,
        rows: [],
      });
    }

    const inItems = await db
      .select({
        id: qcInspectionItems.id,
        category: qcInspectionItems.category,
        subCategory: qcInspectionItems.subCategory,
        itemCode: qcInspectionItems.itemCode,
        itemLabel: qcInspectionItems.itemLabel,
        result: qcInspectionItems.result,
        comment: qcInspectionItems.comment,
      })
      .from(qcInspectionItems)
      .where(eq(qcInspectionItems.inspectionId, qcIn.id));

    const outItems = await db
      .select({
        id: qcOutInspectionItems.id,
        category: qcOutInspectionItems.category,
        subCategory: qcOutInspectionItems.subCategory,
        itemCode: qcOutInspectionItems.itemCode,
        itemLabel: qcOutInspectionItems.itemLabel,
        qcInItemId: qcOutInspectionItems.qcInItemId,
        status: qcOutInspectionItems.status,
        notes: qcOutInspectionItems.notes,
      })
      .from(qcOutInspectionItems)
      .where(eq(qcOutInspectionItems.inspectionId, qcOut.id));

    // Match by qcInItemId first, fallback to itemCode, fallback to itemLabel.
    const outByQcInId = new Map(outItems.filter((o) => o.qcInItemId).map((o) => [o.qcInItemId!, o]));
    const outByCode = new Map(outItems.filter((o) => o.itemCode && !o.qcInItemId).map((o) => [o.itemCode!, o]));
    const outByLabel = new Map(outItems.filter((o) => !o.qcInItemId && !o.itemCode).map((o) => [o.itemLabel, o]));

    type ComparisonRow = {
      category: string | null;
      subCategory: string | null;
      itemCode: string | null;
      itemLabel: string;
      qcInItemId: string | null;
      qcInResult: string | null;
      qcInComment: string | null;
      qcOutItemId: string | null;
      qcOutResult: string | null;
      qcOutNotes: string | null;
      damage: boolean;
      fixed: boolean;
      missingAtOut: boolean;
    };
    const rows: ComparisonRow[] = inItems.map((i): ComparisonRow => {
      const o =
        outByQcInId.get(i.id) ??
        (i.itemCode ? outByCode.get(i.itemCode) : undefined) ??
        outByLabel.get(i.itemLabel) ??
        null;
      const damage = !!(o && i.result === 'PASS' && o.status === 'FAIL');
      const fixed = !!(o && i.result === 'FAIL' && o.status === 'PASS');
      return {
        category: i.category,
        subCategory: i.subCategory,
        itemCode: i.itemCode,
        itemLabel: i.itemLabel,
        qcInItemId: i.id,
        qcInResult: i.result,
        qcInComment: i.comment,
        qcOutItemId: o?.id ?? null,
        qcOutResult: o?.status ?? null,
        qcOutNotes: o?.notes ?? null,
        damage,           // PASS at In, FAIL at Out
        fixed,            // FAIL at In, PASS at Out
        missingAtOut: !o, // item present at QC In but not at QC Out
      };
    });

    // Items that appeared in QC Out but not QC In (rare — master changed).
    const inIdSet = new Set(inItems.map((i) => i.id));
    const inCodeSet = new Set(inItems.map((i) => i.itemCode));
    const inLabelSet = new Set(inItems.map((i) => i.itemLabel));
    const orphanOut = outItems.filter((o) =>
      (!o.qcInItemId || !inIdSet.has(o.qcInItemId)) &&
      (!o.itemCode || !inCodeSet.has(o.itemCode)) &&
      !inLabelSet.has(o.itemLabel),
    );
    for (const o of orphanOut) {
      rows.push({
        category: o.category,
        subCategory: o.subCategory,
        itemCode: o.itemCode,
        itemLabel: o.itemLabel,
        qcInItemId: null,
        qcInResult: null,
        qcInComment: null,
        qcOutItemId: o.id,
        qcOutResult: o.status,
        qcOutNotes: o.notes,
        damage: false,
        fixed: false,
        missingAtOut: false,
      });
    }

    const summary = {
      total: rows.length,
      damageCount: rows.filter((r) => r.damage).length,
      fixedCount: rows.filter((r) => r.fixed).length,
      missingAtOutCount: rows.filter((r) => r.missingAtOut).length,
    };

    return success('OK', {
      qcInInspectionId: qcIn.id,
      qcOutInspectionId: qcOut.id,
      overallStatus: qcOut.overallStatus,
      summary,
      rows,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

void qcOutChecklist;
