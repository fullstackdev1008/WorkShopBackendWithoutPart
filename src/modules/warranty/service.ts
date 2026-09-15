import { FastifyRequest } from 'fastify';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  warrantyParts,
  jobCardItems,
  jobCards,
  vehicles,
  customers,
  users,
} from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { generateTagNo } from '../../shared/utils/warranty';

type Status = 'HELD' | 'PENDING_APPROVAL' | 'APPROVED' | 'SCRAPPED' | 'REJECTED';

// ─── Auto-creator helper ───────────────────────────────────────────────────
// Called from completeItemWork after a flagged item is completed. Pulls the
// linked job card → vehicle → customer to populate denormalised columns so
// the warranty store list doesn't need to join through the visit history
// (job cards eventually archive when the vehicle leaves the workshop).
export async function autoCreateForCompletedItem(opts: {
  jobCardItemId: string;
  technicianId: string;
}): Promise<string | null> {
  const [item] = await db
    .select({
      id: jobCardItems.id,
      jobCardId: jobCardItems.jobCardId,
      jobDescription: jobCardItems.jobDescription,
      partsRequired: jobCardItems.partsRequired,
      isWarrantyClaim: jobCardItems.isWarrantyClaim,
      warrantyClaimNo: jobCardItems.warrantyClaimNo,
      warrantyOem: jobCardItems.warrantyOem,
    })
    .from(jobCardItems)
    .where(eq(jobCardItems.id, opts.jobCardItemId))
    .limit(1);
  if (!item || !item.isWarrantyClaim) return null;

  // Don't double-tag — exit if a warranty row already exists for this item.
  const [existing] = await db
    .select({ id: warrantyParts.id })
    .from(warrantyParts)
    .where(eq(warrantyParts.jobCardItemId, opts.jobCardItemId))
    .limit(1);
  if (existing) return null;

  const [jc] = await db
    .select({ vehicleId: jobCards.vehicleId })
    .from(jobCards)
    .where(eq(jobCards.id, item.jobCardId))
    .limit(1);
  let customerId: string | null = null;
  if (jc?.vehicleId) {
    const [veh] = await db
      .select({ customerId: vehicles.customerId })
      .from(vehicles)
      .where(eq(vehicles.id, jc.vehicleId))
      .limit(1);
    customerId = veh?.customerId ?? null;
  }

  const tagNo = await generateTagNo();
  const [row] = await db
    .insert(warrantyParts)
    .values({
      tagNo,
      jobCardItemId: item.id,
      vehicleId: jc?.vehicleId ?? null,
      customerId,
      partName: item.partsRequired || item.jobDescription,
      partNumber: item.partsRequired,
      warrantyClaimNo: item.warrantyClaimNo,
      warrantyOem: item.warrantyOem,
      technicianId: opts.technicianId,
    })
    .returning();
  return row.tagNo;
}

// ─── Inventory list ────────────────────────────────────────────────────────
// Supports status filter + free-text search across tag_no / part_name /
// claim_no / vehicle registration.
export async function listInventory(request: FastifyRequest) {
  try {
    const q = request.query as { status?: string; q?: string; page?: string | number; limit?: string | number };
    const status = q.status && q.status !== 'ALL' ? (q.status as Status) : undefined;
    const search = q.q?.trim() || undefined;
    const paginated = q.page != null || q.limit != null;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;

    const filters: any[] = [];
    if (status) filters.push(eq(warrantyParts.status, status));
    if (search) {
      filters.push(or(
        ilike(warrantyParts.tagNo, `%${search}%`),
        ilike(warrantyParts.partName, `%${search}%`),
        ilike(warrantyParts.warrantyClaimNo ?? sql`''`, `%${search}%`),
        // join-free reg search via subselect
        sql`EXISTS (SELECT 1 FROM vehicles v WHERE v.id = ${warrantyParts.vehicleId} AND v.registration_number ILIKE ${'%' + search + '%'})`,
      ));
    }

    const where = filters.length > 0 ? and(...filters) : sql`true`;

    const baseQuery = db
      .select({
        id: warrantyParts.id,
        tagNo: warrantyParts.tagNo,
        partName: warrantyParts.partName,
        partNumber: warrantyParts.partNumber,
        status: warrantyParts.status,
        warrantyClaimNo: warrantyParts.warrantyClaimNo,
        warrantyOem: warrantyParts.warrantyOem,
        removedAt: warrantyParts.removedAt,
        approvedAt: warrantyParts.approvedAt,
        scrappedAt: warrantyParts.scrappedAt,
        notes: warrantyParts.notes,
        vehicleId: warrantyParts.vehicleId,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        technicianName: users.username,
      })
      .from(warrantyParts)
      .leftJoin(vehicles, eq(vehicles.id, warrantyParts.vehicleId))
      .leftJoin(customers, eq(customers.id, warrantyParts.customerId))
      .leftJoin(users, eq(users.id, warrantyParts.technicianId))
      .where(where)
      .orderBy(desc(warrantyParts.removedAt));

    const rows = paginated
      ? await baseQuery.limit(limit).offset(offset)
      : await baseQuery.limit(200);

    // Filtered total — drives pagination metadata.
    const [{ totalFiltered }] = await db
      .select({ totalFiltered: sql<number>`COUNT(*)::int` })
      .from(warrantyParts)
      .leftJoin(vehicles, eq(vehicles.id, warrantyParts.vehicleId))
      .leftJoin(customers, eq(customers.id, warrantyParts.customerId))
      .leftJoin(users, eq(users.id, warrantyParts.technicianId))
      .where(where);

    const data = rows.map((r) => ({
      ...r,
      customerName: `${r.customerFirstName ?? ''} ${r.customerLastName ?? ''}`.trim() || null,
    }));

    // Counts per status for the filter-chip badges.
    const counts = await db
      .select({ status: warrantyParts.status, n: sql<number>`COUNT(*)::int` })
      .from(warrantyParts)
      .groupBy(warrantyParts.status);
    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = Number(c.n);

    if (!paginated) {
      return success('Warranty inventory fetched', { items: data, counts: byStatus });
    }

    const totalNum = Number(totalFiltered) || 0;
    return success('Warranty inventory fetched', {
      items: data,
      counts: byStatus,
      pagination: {
        page,
        limit,
        total: totalNum,
        totalPages: Math.max(1, Math.ceil(totalNum / limit)),
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function getOne(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const [row] = await db
      .select()
      .from(warrantyParts)
      .where(eq(warrantyParts.id, id))
      .limit(1);
    if (!row) return error(HttpStatus.NOT_FOUND, 'Warranty part not found');
    return success('Warranty part fetched', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Status transitions ────────────────────────────────────────────────────

const ALLOWED: Record<Status, Status[]> = {
  HELD:             ['PENDING_APPROVAL', 'SCRAPPED'],      // small workshops sometimes skip OEM submission
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED:         ['SCRAPPED'],
  REJECTED:         ['HELD'],                               // re-submit cycle
  SCRAPPED:         [],
};

async function transition(
  request: FastifyRequest,
  to: Status,
  extra?: (now: Date, actorId: string) => Record<string, unknown>,
) {
  const { id } = request.params as any;
  const actorId = await resolveActorId(request);
  if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

  const [row] = await db
    .select({ id: warrantyParts.id, status: warrantyParts.status })
    .from(warrantyParts)
    .where(eq(warrantyParts.id, id))
    .limit(1);
  if (!row) return error(HttpStatus.NOT_FOUND, 'Warranty part not found');

  const from = row.status as Status;
  if (!ALLOWED[from].includes(to)) {
    return error(
      HttpStatus.BAD_REQUEST,
      `Cannot transition ${from} → ${to}. Allowed from ${from}: ${ALLOWED[from].join(', ') || 'none'}.`,
    );
  }

  const now = new Date();
  const patch = { status: to, updatedAt: now, ...(extra ? extra(now, actorId) : {}) };
  await db.update(warrantyParts).set(patch).where(eq(warrantyParts.id, id));
  return success(`Status changed to ${to}`, { id, status: to });
}

export const submitForApproval = (r: FastifyRequest) => transition(r, 'PENDING_APPROVAL');

export const approve = async (r: FastifyRequest) => {
  const body = (r.body ?? {}) as { approvalDocUrl?: string; notes?: string };
  return transition(r, 'APPROVED', (now, actorId) => ({
    approvedAt: now,
    approvedBy: actorId,
    approvalDocUrl: body.approvalDocUrl ?? null,
    notes: body.notes ?? undefined,
  }));
};

export const reject = async (r: FastifyRequest) => {
  const body = (r.body ?? {}) as { notes?: string };
  return transition(r, 'REJECTED', () => ({ notes: body.notes ?? undefined }));
};

export const scrap = async (r: FastifyRequest) => {
  return transition(r, 'SCRAPPED', (now, actorId) => ({
    scrappedAt: now,
    scrappedBy: actorId,
  }));
};

// ─── Printable tag (HTML) ─────────────────────────────────────────────────
// Returns a self-contained HTML document the FE iframes or opens directly.
// window.print() in the browser turns it into a PDF. Keeps the backend
// dep-free (no pdfkit, no headless browser).
export async function tagHtml(request: FastifyRequest, reply: any) {
  const { id } = request.params as any;
  const [row] = await db
    .select({
      tagNo: warrantyParts.tagNo,
      partName: warrantyParts.partName,
      partNumber: warrantyParts.partNumber,
      warrantyClaimNo: warrantyParts.warrantyClaimNo,
      warrantyOem: warrantyParts.warrantyOem,
      removedAt: warrantyParts.removedAt,
      vehicleId: warrantyParts.vehicleId,
      reg: vehicles.registrationNumber,
      brand: vehicles.brand,
      model: vehicles.model,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
      technicianName: users.username,
    })
    .from(warrantyParts)
    .leftJoin(vehicles, eq(vehicles.id, warrantyParts.vehicleId))
    .leftJoin(customers, eq(customers.id, warrantyParts.customerId))
    .leftJoin(users, eq(users.id, warrantyParts.technicianId))
    .where(eq(warrantyParts.id, id))
    .limit(1);
  if (!row) {
    reply.status(HttpStatus.NOT_FOUND).send('Not found');
    return;
  }
  const customer = `${row.customerFirstName ?? ''} ${row.customerLastName ?? ''}`.trim() || '—';
  const removed = new Date(row.removedAt).toLocaleString();
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${row.tagNo}</title>
<style>
  @page { size: A6; margin: 8mm; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 12px; color: #222; }
  h1 { font-size: 14pt; margin: 0 0 4px; letter-spacing: 1px; }
  .tag-no { font-size: 22pt; font-weight: 700; color: #ff4f31; margin-bottom: 8px; }
  .row { display: grid; grid-template-columns: 80px 1fr; gap: 4px 8px; font-size: 10pt; margin-bottom: 8px; }
  .label { color: #666; }
  .footer { margin-top: 12px; font-size: 8pt; color: #999; border-top: 1px solid #eee; padding-top: 6px; }
  button { display: inline-block; padding: 6px 14px; margin-top: 12px; font-size: 10pt; }
  @media print { button { display: none; } }
</style></head>
<body>
  <h1>WARRANTY PART TAG</h1>
  <div class="tag-no">${row.tagNo}</div>
  <div class="row">
    <div class="label">Part</div><div>${row.partName}</div>
    <div class="label">Part #</div><div>${row.partNumber ?? '—'}</div>
    <div class="label">OEM</div><div>${row.warrantyOem ?? '—'}</div>
    <div class="label">Claim #</div><div>${row.warrantyClaimNo ?? '—'}</div>
  </div>
  <div class="row">
    <div class="label">Vehicle</div><div>${(row.brand ?? '')} ${(row.model ?? '')} — ${row.reg ?? '—'}</div>
    <div class="label">Customer</div><div>${customer}</div>
    <div class="label">Removed</div><div>${removed}</div>
    <div class="label">Technician</div><div>${row.technicianName ?? '—'}</div>
  </div>
  <div class="footer">Generated by ELT Group · Keep this tag attached to the part.</div>
  <button onclick="window.print()">Print</button>
</body></html>`;
  reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
}

// Manual create endpoint — for when the SA didn't flag the item up front but
// the tech discovers a warranty replacement after work has begun. Not in the
// MVP demo flow, but keeps the data model complete.
export async function manualCreate(request: FastifyRequest) {
  try {
    const body = request.body as {
      partName: string;
      partNumber?: string;
      warrantyClaimNo?: string;
      warrantyOem?: string;
      vehicleId?: string;
      jobCardItemId?: string;
    };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    if (!body?.partName?.trim()) return error(HttpStatus.BAD_REQUEST, 'partName is required');

    let customerId: string | null = null;
    if (body.vehicleId) {
      const [veh] = await db
        .select({ customerId: vehicles.customerId })
        .from(vehicles)
        .where(eq(vehicles.id, body.vehicleId))
        .limit(1);
      customerId = veh?.customerId ?? null;
    }

    const tagNo = await generateTagNo();
    const [row] = await db
      .insert(warrantyParts)
      .values({
        tagNo,
        jobCardItemId: body.jobCardItemId ?? null,
        vehicleId: body.vehicleId ?? null,
        customerId,
        partName: body.partName.trim(),
        partNumber: body.partNumber?.trim() ?? null,
        warrantyClaimNo: body.warrantyClaimNo?.trim() ?? null,
        warrantyOem: body.warrantyOem?.trim() ?? null,
        technicianId: actorId,
      })
      .returning();
    return created('Warranty part tagged', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Silence imports linter doesn't like
void inArray;
