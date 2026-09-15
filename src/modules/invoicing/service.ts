import { FastifyRequest, FastifyReply } from 'fastify';
import { and, desc, eq, inArray, isNull, ne, or, sql, count } from 'drizzle-orm';
import { db } from '../../db';
import {
  invoices,
  invoiceLines,
  invoicePayments,
  gatePasses,
  jobCards,
  jobCardItems,
  vehicleCheckIns,
  vehicles,
  customers,
  users,
} from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { generateInvoiceNo, generateGatePassCode } from '../../shared/utils/invoice';
import { setRoStatus } from '../../shared/utils/roStatus';

type InvoiceStatus = 'DRAFT' | 'GENERATED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: any): number => Number(v ?? 0);

// Pulls the items, vehicle/customer and tax config for a job card. Filters
// to approved items only (skips lines the customer rejected). Warranty
// items are kept but priced at 0 to the customer.
async function buildLinesForJobCard(jobCardId: string) {
  const [jc] = await db
    .select({
      id: jobCards.id,
      vehicleId: jobCards.vehicleId,
      checkInId: jobCards.vehicleCheckInId,
      taxLabel: jobCards.taxLabel,
      taxPercentage: jobCards.taxPercentage,
      currencyCode: jobCards.currencyCode,
    })
    .from(jobCards)
    .where(eq(jobCards.id, jobCardId))
    .limit(1);
  if (!jc) return null;

  const [veh] = jc.vehicleId
    ? await db.select({ customerId: vehicles.customerId }).from(vehicles).where(eq(vehicles.id, jc.vehicleId)).limit(1)
    : [{ customerId: null as string | null }];

  const items = await db
    .select({
      id: jobCardItems.id,
      jobDescription: jobCardItems.jobDescription,
      partsRequired: jobCardItems.partsRequired,
      partsCost: jobCardItems.partsCost,
      labourCost: jobCardItems.labourCost,
      quantity: jobCardItems.quantity,
      sortOrder: jobCardItems.sortOrder,
      isApprovedByCustomer: jobCardItems.isApprovedByCustomer,
      isWarrantyClaim: jobCardItems.isWarrantyClaim,
    })
    .from(jobCardItems)
    .where(eq(jobCardItems.jobCardId, jobCardId))
    .orderBy(jobCardItems.sortOrder);

  // Approved-only. Treat NULL as approved when no customer-approval round
  // happened (matches the existing job-card flow that auto-approves drafts).
  const eligible = items.filter((it) => it.isApprovedByCustomer !== false);

  const lines = eligible.map((it, idx) => {
    const qty = num(it.quantity) || 1;
    const parts = num(it.partsCost);
    const labour = num(it.labourCost);
    const lineGross = parts * qty + labour;
    const customerPrice = it.isWarrantyClaim ? 0 : lineGross;
    return {
      source: 'JOB_CARD_ITEM' as const,
      refId: it.id,
      description: it.jobDescription + (it.partsRequired ? ` (${it.partsRequired})` : ''),
      quantity: qty.toFixed(2),
      unitPrice: (it.isWarrantyClaim ? 0 : parts).toFixed(2),
      lineTotal: customerPrice.toFixed(2),
      isWarranty: !!it.isWarrantyClaim,
      sortOrder: idx + 1,
      _customerPrice: customerPrice,
    };
  });

  return { jc, customerId: veh?.customerId ?? null, lines };
}

// ─── Build draft preview (no DB write) ───────────────────────────────────────
// Lets finance preview totals before generating the invoice.
export async function buildPreview(request: FastifyRequest) {
  try {
    const { jobCardId } = request.params as any;
    const data = await buildLinesForJobCard(jobCardId);
    if (!data) return error(HttpStatus.NOT_FOUND, 'Job card not found');
    const subtotal = data.lines.reduce((s, l) => s + l._customerPrice, 0);
    const taxPct = num(data.jc.taxPercentage);
    const taxAmount = (subtotal * taxPct) / 100;
    return success('Preview built', {
      jobCardId,
      taxLabel: data.jc.taxLabel,
      taxPercentage: taxPct,
      currencyCode: data.jc.currencyCode,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: (subtotal + taxAmount).toFixed(2),
      lines: data.lines.map(({ _customerPrice, ...rest }) => rest),
    });
  } catch (err) {
    return serverError(err);
  }
}

// ─── List "Ready for Billing" queue ──────────────────────────────────────────
export async function listReadyForBilling(request: FastifyRequest) {
  try {
    const q = (request.query ?? {}) as { page?: string | number; limit?: string | number };
    const paginated = q.page != null || q.limit != null;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;

    const where = eq(vehicleCheckIns.roStatus, 'READY_FOR_RELEASE');

    const baseQuery = db
      .select({
        checkInId: vehicleCheckIns.id,
        roStatus: vehicleCheckIns.roStatus,
        roStatusAt: vehicleCheckIns.roStatusAt,
        vehicleId: vehicleCheckIns.vehicleId,
        receivingNo: vehicleCheckIns.receivingNo,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerId: customers.id,
      })
      .from(vehicleCheckIns)
      .leftJoin(vehicles, eq(vehicleCheckIns.vehicleId, vehicles.id))
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(where)
      .orderBy(desc(vehicleCheckIns.roStatusAt));

    const rows = paginated
      ? await baseQuery.limit(limit).offset(offset)
      : await baseQuery;

    // For each check-in, find the latest non-void job card and any active invoice.
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const [jc] = await db
          .select({ id: jobCards.id, totalEstimate: jobCards.totalEstimate })
          .from(jobCards)
          .where(eq(jobCards.vehicleCheckInId, r.checkInId))
          .orderBy(desc(jobCards.createdAt))
          .limit(1);
        let invoice: any = null;
        if (jc) {
          const [inv] = await db
            .select({
              id: invoices.id,
              invoiceNo: invoices.invoiceNo,
              status: invoices.status,
              totalAmount: invoices.totalAmount,
              paidAmount: invoices.paidAmount,
            })
            .from(invoices)
            .where(and(eq(invoices.jobCardId, jc.id), ne(invoices.status, 'VOID')))
            .limit(1);
          invoice = inv ?? null;
        }
        const customerName = `${r.customerFirstName ?? ''} ${r.customerLastName ?? ''}`.trim() || null;
        return { ...r, customerName, jobCard: jc ?? null, invoice };
      }),
    );

    if (!paginated) {
      return success('OK', enriched);
    }

    const [{ totalRows }] = await db
      .select({ totalRows: count() })
      .from(vehicleCheckIns)
      .where(where);
    const totalNum = Number(totalRows) || 0;

    // Aggregate stats across ALL ready-for-billing rows (not just this page),
    // so the dashboard StatCards stay accurate while the table paginates.
    const allCheckInIds = (await db
      .select({ id: vehicleCheckIns.id })
      .from(vehicleCheckIns)
      .where(where)).map((r) => r.id);

    let pending = 0;
    let generated = 0;
    let collectedSum = 0;
    let paidCount = 0;

    if (allCheckInIds.length > 0) {
      const latestJcs = await db
        .select({
          checkInId: jobCards.vehicleCheckInId,
          id: jobCards.id,
          createdAt: jobCards.createdAt,
        })
        .from(jobCards)
        .where(inArray(jobCards.vehicleCheckInId, allCheckInIds))
        .orderBy(desc(jobCards.createdAt));
      const latestJcByCheckIn = new Map<string, string>();
      for (const j of latestJcs) {
        if (!j.checkInId) continue;
        if (!latestJcByCheckIn.has(j.checkInId)) latestJcByCheckIn.set(j.checkInId, j.id);
      }

      const jcIds = Array.from(latestJcByCheckIn.values());
      const allInvoices = jcIds.length === 0 ? [] : await db
        .select({
          jobCardId: invoices.jobCardId,
          status: invoices.status,
          paidAmount: invoices.paidAmount,
        })
        .from(invoices)
        .where(and(inArray(invoices.jobCardId, jcIds), ne(invoices.status, 'VOID')));
      const invByJc = new Map(allInvoices.map((i) => [i.jobCardId, i]));

      for (const id of allCheckInIds) {
        const jcId = latestJcByCheckIn.get(id);
        const inv = jcId ? invByJc.get(jcId) : undefined;
        if (!inv) {
          pending += 1;
        } else if (inv.status !== 'PAID') {
          generated += 1;
        } else {
          paidCount += 1;
          collectedSum += Number(inv.paidAmount ?? 0);
        }
      }
    }

    const stats = {
      pending,
      generated,
      collected: collectedSum,
      avg: paidCount > 0 ? collectedSum / paidCount : 0,
    };

    return success('OK', {
      data: enriched,
      pagination: {
        page,
        limit,
        total: totalNum,
        totalPages: Math.max(1, Math.ceil(totalNum / limit)),
      },
      stats,
    });
  } catch (err) {
    return serverError(err);
  }
}

// ─── Generate (create + finalize) ────────────────────────────────────────────
// One step: build lines from job card → insert invoice + lines → status
// flips to GENERATED. Re-issue after VOID re-runs this path.
export async function generate(request: FastifyRequest) {
  try {
    const { jobCardId } = request.params as any;
    const body = (request.body ?? {}) as {
      adjustments?: { description: string; amount: number }[];
      discountAmount?: number;
      notes?: string;
    };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    // Refuse to create a second active invoice for the same job card.
    const [existing] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.jobCardId, jobCardId), ne(invoices.status, 'VOID')))
      .limit(1);
    if (existing) {
      return error(HttpStatus.CONFLICT, 'An active invoice already exists for this job card');
    }

    const data = await buildLinesForJobCard(jobCardId);
    if (!data) return error(HttpStatus.NOT_FOUND, 'Job card not found');
    if (data.lines.length === 0) {
      return error(HttpStatus.BAD_REQUEST, 'No approved items to invoice');
    }

    const adjustments = (body.adjustments ?? []).map((a, idx) => ({
      source: 'ADJUSTMENT' as const,
      refId: null,
      description: a.description,
      quantity: '1.00',
      unitPrice: num(a.amount).toFixed(2),
      lineTotal: num(a.amount).toFixed(2),
      isWarranty: false,
      sortOrder: data.lines.length + idx + 1,
      _customerPrice: num(a.amount),
    }));

    const allLines = [...data.lines, ...adjustments];
    const subtotal = allLines.reduce((s, l) => s + l._customerPrice, 0);
    const discount = Math.max(0, num(body.discountAmount));
    const taxableBase = Math.max(0, subtotal - discount);
    const taxPct = num(data.jc.taxPercentage);
    const taxAmount = (taxableBase * taxPct) / 100;
    const total = taxableBase + taxAmount;

    const invoiceNo = await generateInvoiceNo();
    const now = new Date();

    const [created_inv] = await db.transaction(async (tx: any) => {
      const [inv] = await tx
        .insert(invoices)
        .values({
          invoiceNo,
          jobCardId,
          checkInId: data.jc.checkInId,
          vehicleId: data.jc.vehicleId,
          customerId: data.customerId,
          status: 'GENERATED' as InvoiceStatus,
          subtotal: subtotal.toFixed(2),
          taxLabel: data.jc.taxLabel,
          taxPercentage: taxPct.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          discountAmount: discount.toFixed(2),
          totalAmount: total.toFixed(2),
          paidAmount: '0.00',
          currencyCode: data.jc.currencyCode,
          notes: body.notes ?? null,
          generatedAt: now,
          generatedBy: actorId,
        })
        .returning();

      if (allLines.length > 0) {
        await tx.insert(invoiceLines).values(
          allLines.map(({ _customerPrice, ...rest }) => ({ ...rest, invoiceId: inv.id })),
        );
      }
      return [inv];
    });

    return created('Invoice generated', created_inv);
  } catch (err) {
    console.log('invoice generate error', err);
    return serverError(err);
  }
}

// ─── Get one ────────────────────────────────────────────────────────────────
export async function getOne(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const [inv] = await db
      .select({
        invoice: invoices,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(invoices)
      .leftJoin(vehicles, eq(invoices.vehicleId, vehicles.id))
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.id, id))
      .limit(1);
    if (!inv) return error(HttpStatus.NOT_FOUND, 'Invoice not found');

    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(invoiceLines.sortOrder);

    const payments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, id))
      .orderBy(desc(invoicePayments.paidAt));

    const [gp] = await db
      .select()
      .from(gatePasses)
      .where(and(eq(gatePasses.invoiceId, id), ne(gatePasses.status, 'VOIDED')))
      .limit(1);

    const customerName = `${inv.customerFirstName ?? ''} ${inv.customerLastName ?? ''}`.trim() || null;
    return success('OK', {
      ...inv.invoice,
      vehicle: { registrationNumber: inv.registrationNumber, brand: inv.brand, model: inv.model },
      customerName,
      lines,
      payments,
      gatePass: gp ?? null,
    });
  } catch (err) {
    return serverError(err);
  }
}

// ─── Record payment ─────────────────────────────────────────────────────────
export async function recordPayment(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as {
      amount: number;
      mode: 'CASH' | 'CARD' | 'UPI' | 'BANK' | 'CHEQUE';
      referenceNo?: string;
      notes?: string;
    };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    if (!body?.amount || body.amount <= 0) {
      return error(HttpStatus.BAD_REQUEST, 'Amount must be greater than zero');
    }
    if (!body.mode) return error(HttpStatus.BAD_REQUEST, 'Payment mode is required');

    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) return error(HttpStatus.NOT_FOUND, 'Invoice not found');
    if (inv.status === 'VOID') return error(HttpStatus.BAD_REQUEST, 'Cannot record payment on voided invoice');
    if (inv.status === 'PAID') return error(HttpStatus.BAD_REQUEST, 'Invoice is already paid');

    const totalDue = num(inv.totalAmount);
    const alreadyPaid = num(inv.paidAmount);
    const remaining = totalDue - alreadyPaid;
    const amount = Math.min(num(body.amount), remaining);
    if (amount <= 0) return error(HttpStatus.BAD_REQUEST, 'Invoice is already fully paid');

    const newPaid = alreadyPaid + amount;
    const fullyPaid = newPaid + 0.001 >= totalDue;
    const nextStatus: InvoiceStatus = fullyPaid ? 'PAID' : 'PARTIALLY_PAID';

    let gatePassRow: any = null;

    await db.transaction(async (tx: any) => {
      await tx.insert(invoicePayments).values({
        invoiceId: id,
        amount: amount.toFixed(2),
        mode: body.mode,
        referenceNo: body.referenceNo ?? null,
        capturedBy: actorId,
        notes: body.notes ?? null,
      });
      await tx
        .update(invoices)
        .set({ paidAmount: newPaid.toFixed(2), status: nextStatus, updatedAt: new Date() })
        .where(eq(invoices.id, id));

      // On full payment, mint a gate pass if none active.
      if (fullyPaid) {
        const [existingGp] = await tx
          .select({ id: gatePasses.id })
          .from(gatePasses)
          .where(and(eq(gatePasses.invoiceId, id), eq(gatePasses.status, 'ACTIVE')))
          .limit(1);
        if (!existingGp) {
          const code = await generateGatePassCode();
          const [gp] = await tx
            .insert(gatePasses)
            .values({
              code,
              invoiceId: id,
              checkInId: inv.checkInId,
              vehicleId: inv.vehicleId,
              generatedBy: actorId,
            })
            .returning();
          gatePassRow = gp;
        }
      }
    });

    return success('Payment recorded', {
      invoiceId: id,
      status: nextStatus,
      paidAmount: newPaid.toFixed(2),
      gatePass: gatePassRow,
    });
  } catch (err) {
    console.log('record payment error', err);
    return serverError(err);
  }
}

// ─── Void invoice ────────────────────────────────────────────────────────────
// Allowed only when GENERATED (no payments captured). VOIDs any active gate
// pass too. Re-issue is then possible because the active-per-jc index is
// partial on status<>'VOID'.
export async function voidInvoice(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = (request.body ?? {}) as { reason?: string };
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) return error(HttpStatus.NOT_FOUND, 'Invoice not found');
    if (inv.status === 'VOID') return error(HttpStatus.BAD_REQUEST, 'Already voided');
    if (num(inv.paidAmount) > 0) {
      return error(HttpStatus.BAD_REQUEST, 'Cannot void invoice with payments — refund externally and re-issue.');
    }

    const now = new Date();
    await db.transaction(async (tx: any) => {
      await tx
        .update(invoices)
        .set({ status: 'VOID', voidedAt: now, voidedBy: actorId, voidReason: body.reason ?? null, updatedAt: now })
        .where(eq(invoices.id, id));
      await tx
        .update(gatePasses)
        .set({ status: 'VOIDED', updatedAt: now })
        .where(and(eq(gatePasses.invoiceId, id), eq(gatePasses.status, 'ACTIVE')));
    });

    return success('Invoice voided', { id });
  } catch (err) {
    return serverError(err);
  }
}

// ─── Printable invoice HTML ─────────────────────────────────────────────────
export async function invoiceHtml(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as any;
  const [inv] = await db
    .select({
      invoice: invoices,
      registrationNumber: vehicles.registrationNumber,
      brand: vehicles.brand,
      model: vehicles.model,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
      customerEmail: customers.primaryEmail,
    })
    .from(invoices)
    .leftJoin(vehicles, eq(invoices.vehicleId, vehicles.id))
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!inv) {
    reply.status(404).send('Not found');
    return;
  }
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(invoiceLines.sortOrder);

  const i = inv.invoice;
  const fmt = (v: any) => `${i.currencyCode} ${Number(v ?? 0).toFixed(2)}`;
  const rows = lines.map((l) => `
    <tr>
      <td>${escapeHtml(l.description)}${l.isWarranty ? ' <span class="warr">[WARRANTY]</span>' : ''}</td>
      <td class="r">${Number(l.quantity).toFixed(2)}</td>
      <td class="r">${fmt(l.unitPrice)}</td>
      <td class="r">${fmt(l.lineTotal)}</td>
    </tr>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${i.invoiceNo}</title>
<style>
  *{box-sizing:border-box;font-family:-apple-system,Helvetica,Arial,sans-serif}
  body{margin:24px;color:#222}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
  .no{font-size:22px;color:#ff4f31;font-weight:700}
  .meta{font-size:12px;color:#555;line-height:1.6}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
  th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left}
  th{background:#f7f7f7;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#777}
  .r{text-align:right}
  .totals{margin-left:auto;margin-top:12px;width:300px;font-size:13px}
  .totals div{display:flex;justify-content:space-between;padding:4px 0}
  .totals .grand{border-top:2px solid #222;padding-top:8px;margin-top:6px;font-size:16px;font-weight:700}
  .warr{font-size:10px;color:#0061ff;font-weight:600}
  .status{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:600}
  .s-GENERATED{background:#fef3c7;color:#92400e}
  .s-PARTIALLY_PAID{background:#dbeafe;color:#1e40af}
  .s-PAID{background:#dcfce7;color:#166534}
  .s-VOID{background:#fee2e2;color:#991b1b}
  .pr{margin-top:16px;padding:10px;background:#f9fafb;border:1px dashed #d1d5db;font-size:12px;color:#444}
  @media print{button{display:none}}
</style></head><body>
<div class="hd">
  <div>
    <div class="no">${i.invoiceNo}</div>
    <div class="meta">
      Generated ${i.generatedAt ? new Date(i.generatedAt as any).toLocaleString() : '—'}<br>
      <span class="status s-${i.status}">${i.status.replace('_', ' ')}</span>
    </div>
  </div>
  <div class="meta" style="text-align:right">
    <strong>${escapeHtml(`${inv.customerFirstName ?? ''} ${inv.customerLastName ?? ''}`.trim())}</strong><br>
    ${escapeHtml(inv.customerEmail ?? '')}<br>
    Vehicle: <strong>${escapeHtml((inv.registrationNumber ?? '').toUpperCase())}</strong><br>
    ${escapeHtml(inv.brand ?? '')} ${escapeHtml(inv.model ?? '')}
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div><span>Subtotal</span><span>${fmt(i.subtotal)}</span></div>
  ${num(i.discountAmount) > 0 ? `<div><span>Discount</span><span>− ${fmt(i.discountAmount)}</span></div>` : ''}
  <div><span>${escapeHtml(i.taxLabel)} (${Number(i.taxPercentage).toFixed(2)}%)</span><span>${fmt(i.taxAmount)}</span></div>
  <div class="grand"><span>Total Due</span><span>${fmt(i.totalAmount)}</span></div>
  <div><span>Paid</span><span>${fmt(i.paidAmount)}</span></div>
  <div><span>Balance</span><span>${fmt(num(i.totalAmount) - num(i.paidAmount))}</span></div>
</div>
${i.notes ? `<div class="pr">${escapeHtml(i.notes)}</div>` : ''}
<div style="margin-top:24px;text-align:center">
  <button onclick="window.print()" style="padding:8px 16px;background:#ff4f31;color:#fff;border:0;border-radius:6px;cursor:pointer">Print</button>
</div>
</body></html>`;

  reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
}

function escapeHtml(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

// Exposed so the gate-pass module can reuse without circular import.
export { setRoStatus as _setRoStatus };
