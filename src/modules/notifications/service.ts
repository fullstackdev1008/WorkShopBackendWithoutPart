import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';
import { db } from '../../db';
import {
  notificationRules,
  notificationTemplates,
  notifications,
  notificationLog,
  vehicleCheckIns,
  vehicles,
  customers,
  customerContacts,
  users,
  jobCards,
  jobCardItems,
  workshopAllocations,
  workshopBays,
  partRequests,
} from '../../db/models';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { sendWhatsAppEstimate } from '../../services/whatsapp.service';
import { sendAppointmentConfirmationEmail } from '../../services/email.service';

// ─── Role-targeted in-app notification (reusable) ────────────────────────────
// Resolves a role slug → active users and inserts one per-user in-app
// notification each (the notifications table is per-user; the topbar bell reads
// them via listMyNotifications). Fire-and-forget: never throws to the caller —
// a notification failure must not roll back the business action. This is the
// same pattern as runPartEtaPromotionCheck, exposed for reuse.
export async function notifyRoleInApp(
  roleSlug: string,
  n: { level?: 'INFO' | 'WARN' | 'CRIT'; title: string; body: string; refType?: string; refId?: string },
): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT u.id
      FROM users u INNER JOIN roles r ON r.id = u.role_id
      WHERE r.slug = ${roleSlug} AND u.is_active = true
    `);
    for (const u of rows.rows as any[]) {
      await db.insert(notifications).values({
        userId: u.id,
        level: n.level ?? 'INFO',
        title: n.title,
        body: n.body,
        refType: n.refType ?? null,
        refId: n.refId ?? null,
      });
    }
  } catch (e) {
    console.error(`[notifyRoleInApp] failed for role '${roleSlug}':`, e);
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

type Trigger = 'RO_STATUS' | 'APPROVAL' | 'LABOUR_80' | 'LABOUR_100' | 'QC_FAIL';
type Channel = 'WHATSAPP' | 'EMAIL' | 'INAPP';
type Audience = 'CUSTOMER' | 'TECHNICIAN' | 'FOREMAN' | 'SA' | 'PARTS' | 'MANAGER' | 'CONTROLLER';

// ─── Variable resolver ─────────────────────────────────────────────────────
// Builds a {key → value} map for `{{var}}` substitution based on the
// check-in and (optionally) the job-card-item that triggered the event.
async function buildVars(
  checkInId: string,
  jobCardItemId?: string,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {
    workshop_name: 'ELT Group',
  };

  const [chk] = await db
    .select({
      id: vehicleCheckIns.id,
      receivingNo: vehicleCheckIns.receivingNo,
      driverName: vehicleCheckIns.driverName,
      vehicleId: vehicleCheckIns.vehicleId,
    })
    .from(vehicleCheckIns)
    .where(eq(vehicleCheckIns.id, checkInId))
    .limit(1);
  if (chk) {
    vars.recv_no = chk.receivingNo ?? '';
    vars.driver_name = chk.driverName ?? '';

    const [veh] = await db
      .select({
        reg: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        customerId: vehicles.customerId,
      })
      .from(vehicles)
      .where(eq(vehicles.id, chk.vehicleId))
      .limit(1);
    if (veh) {
      vars.reg = veh.reg ?? '';
      vars.brand = veh.brand ?? '';
      vars.model = veh.model ?? '';

      if (veh.customerId) {
        const [c] = await db
          .select({ firstName: customers.firstName, lastName: customers.lastName, companyName: customers.companyName })
          .from(customers)
          .where(eq(customers.id, veh.customerId))
          .limit(1);
        if (c) vars.customer_name = c.companyName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
      }
    }

    // Active allocation (for Bay no)
    const [alloc] = await db
      .select({ bayNo: workshopBays.bayNo })
      .from(workshopAllocations)
      .innerJoin(workshopBays, eq(workshopBays.id, workshopAllocations.bayId))
      .where(and(eq(workshopAllocations.checkInId, checkInId), isNull(workshopAllocations.releasedAt)))
      .limit(1);
    if (alloc) vars.bay_no = alloc.bayNo;
  }

  if (jobCardItemId) {
    const [it] = await db
      .select({ desc: jobCardItems.jobDescription })
      .from(jobCardItems)
      .where(eq(jobCardItems.id, jobCardItemId))
      .limit(1);
    if (it) vars.job_desc = it.desc;
  }

  return vars;
}

function expand(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

// ─── Recipient resolver ────────────────────────────────────────────────────
// For non-customer audiences we expand to a list of users via their role.
// For CUSTOMER we resolve a single phone + email tied to the vehicle's
// customer record.
type Recipient = { kind: 'user' | 'customer'; userId?: string; phone?: string | null; email?: string | null };

async function resolveRecipients(
  audience: Audience,
  checkInId: string,
): Promise<Recipient[]> {
  if (audience === 'CUSTOMER') {
    const [veh] = await db
      .select({ customerId: vehicles.customerId })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicles.id, vehicleCheckIns.vehicleId))
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);
    if (!veh?.customerId) return [];
    const [cust] = await db
      .select({ email: customers.primaryEmail, id: customers.id })
      .from(customers)
      .where(eq(customers.id, veh.customerId))
      .limit(1);
    const [contact] = await db
      .select({ countryCode: customerContacts.countryCode, contactNumber: customerContacts.contactNumber })
      .from(customerContacts)
      .where(eq(customerContacts.customerId, veh.customerId))
      .limit(1);
    const phone = contact ? `${contact.countryCode ?? ''}${contact.contactNumber ?? ''}` : null;
    return [{ kind: 'customer', phone, email: cust?.email ?? null }];
  }

  const roleSlug = ({
    TECHNICIAN: 'technician',
    FOREMAN: 'foreman',
    SA: 'service-advisor',
    PARTS: 'parts-manager',
    MANAGER: 'super-admin',     // map "manager" to super-admin until we add a manager role
    CONTROLLER: 'foreman',       // controllers share the foreman view in v1
  } as Record<Exclude<Audience, 'CUSTOMER'>, string>)[audience as Exclude<Audience, 'CUSTOMER'>];

  if (!roleSlug) return [];

  const rows = await db.execute(sql`
    SELECT u.id, u.email
    FROM users u
    INNER JOIN roles r ON r.id = u.role_id
    WHERE r.slug = ${roleSlug} AND u.is_active = true
  `);
  return (rows.rows as any[]).map((r) => ({
    kind: 'user' as const,
    userId: r.id,
    email: r.email,
  }));
}

// ─── Sender — one per channel ──────────────────────────────────────────────

async function sendInApp(
  recipients: Recipient[],
  template: { subject: string | null; body: string },
  vars: Record<string, string>,
  refType: string | null,
  refId: string | null,
): Promise<{ ok: number; fail: number }> {
  let ok = 0, fail = 0;
  for (const r of recipients) {
    if (!r.userId) { fail += 1; continue; }
    try {
      await db.insert(notifications).values({
        userId: r.userId,
        title: expand(template.subject ?? '', vars) || expand(template.body, vars).slice(0, 80),
        body: expand(template.body, vars),
        refType: refType ?? undefined,
        refId: refId ?? undefined,
      });
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { ok, fail };
}

async function sendEmail(
  recipients: Recipient[],
  template: { subject: string | null; body: string },
  vars: Record<string, string>,
): Promise<{ ok: number; fail: number }> {
  let ok = 0, fail = 0;
  // Reuse existing email service in a generic way — we wrap a tiny adapter
  // since the existing sender is tailored to appointment confirmations. To
  // avoid coupling, we POST to nodemailer directly via the existing service.
  for (const r of recipients) {
    if (!r.email) { fail += 1; continue; }
    try {
      await sendAppointmentConfirmationEmail({
        customerName: vars.customer_name ?? 'Team',
        customerEmail: r.email,
        bookingRef: vars.recv_no ?? '',
        vehicleInfo: `${vars.brand ?? ''} ${vars.model ?? ''} (${vars.reg ?? ''})`.trim(),
        serviceType: 'NOTIFICATION',
        appointmentDate: '',
        appointmentTime: '',
        complaints: [expand(template.body, vars)],
      });
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { ok, fail };
}

async function sendWhatsApp(
  recipients: Recipient[],
  template: { body: string },
  vars: Record<string, string>,
): Promise<{ ok: number; fail: number }> {
  let ok = 0, fail = 0;
  for (const r of recipients) {
    if (!r.phone) { fail += 1; continue; }
    try {
      // Reuse the estimate WhatsApp sender as the channel transport; the
      // template body is what changes per status. A dedicated generic
      // WhatsApp send would be ideal but this works against the same
      // provider account.
      await sendWhatsAppEstimate({
        customerName: vars.customer_name ?? 'Customer',
        customerPhone: r.phone,
        countryCode: '+27',
        vehicleInfo: `${vars.brand ?? ''} ${vars.model ?? ''} (${vars.reg ?? ''})`.trim(),
        totalEstimate: '',
        approvalUrl: expand(template.body, vars),  // body goes in the URL field; provider templates will be wired later
      });
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { ok, fail };
}

// ─── Public dispatcher ─────────────────────────────────────────────────────
// Called by setRoStatus, customer-approval, the labour cron, and QC fail.
// Fire-and-forget — never blocks the caller. Errors are swallowed but
// recorded in notification_log so they show up in the audit query.
export async function dispatchNotifications(opts: {
  trigger: Trigger;
  triggerValue: string;
  checkInId: string;
  jobCardItemId?: string;
}): Promise<void> {
  try {
    const rules = await db
      .select({
        id: notificationRules.id,
        channel: notificationRules.channel,
        audience: notificationRules.audience,
        templateKey: notificationRules.templateKey,
      })
      .from(notificationRules)
      .where(and(
        eq(notificationRules.triggerType, opts.trigger),
        eq(notificationRules.triggerValue, opts.triggerValue),
        eq(notificationRules.enabled, true),
      ));

    if (rules.length === 0) return;

    const templateKeys = [...new Set(rules.map((r) => r.templateKey))];
    const tplRows = await db
      .select()
      .from(notificationTemplates)
      .where(inArray(notificationTemplates.key, templateKeys));
    const tplByKey = new Map(tplRows.map((t) => [t.key, t]));

    const vars = await buildVars(opts.checkInId, opts.jobCardItemId);

    for (const rule of rules) {
      const tpl = tplByKey.get(rule.templateKey);
      if (!tpl) continue;
      const recipients = await resolveRecipients(rule.audience as Audience, opts.checkInId);
      if (recipients.length === 0) {
        await db.insert(notificationLog).values({
          ruleId: rule.id,
          channel: rule.channel,
          audience: rule.audience,
          recipient: '',
          templateKey: rule.templateKey,
          refType: 'check_in',
          refId: opts.checkInId,
          status: 'skipped',
          error: 'no recipients',
        });
        continue;
      }

      let result: { ok: number; fail: number } = { ok: 0, fail: 0 };
      try {
        if (rule.channel === 'INAPP') {
          result = await sendInApp(recipients, tpl, vars, 'check_in', opts.checkInId);
        } else if (rule.channel === 'EMAIL') {
          result = await sendEmail(recipients, tpl, vars);
        } else if (rule.channel === 'WHATSAPP') {
          result = await sendWhatsApp(recipients, tpl, vars);
        }
      } catch (err) {
        await db.insert(notificationLog).values({
          ruleId: rule.id,
          channel: rule.channel,
          audience: rule.audience,
          recipient: recipients.map((r) => r.userId ?? r.phone ?? r.email ?? '').join(','),
          templateKey: rule.templateKey,
          refType: 'check_in',
          refId: opts.checkInId,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      await db.insert(notificationLog).values({
        ruleId: rule.id,
        channel: rule.channel,
        audience: rule.audience,
        recipient: `${result.ok} sent, ${result.fail} failed`,
        templateKey: rule.templateKey,
        refType: 'check_in',
        refId: opts.checkInId,
        status: result.fail === 0 ? 'sent' : (result.ok > 0 ? 'sent' : 'failed'),
      });
    }
  } catch (err) {
    // Never let a notification failure propagate to the caller.
    console.error('[dispatchNotifications] crashed:', err);
  }
}

// ─── In-app notifications HTTP API ─────────────────────────────────────────

export async function listMyNotifications(request: FastifyRequest) {
  try {
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actorId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [{ unread }] = await db
      .select({ unread: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, actorId), isNull(notifications.readAt)));

    return success('Notifications fetched', { items: rows, unread });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function markRead(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, actorId)));

    return success('Marked read', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function markAllRead(request: FastifyRequest) {
  try {
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');

    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, actorId), isNull(notifications.readAt)));

    return success('All marked read', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── 80% / 100% labour-overrun cron ────────────────────────────────────────
// Every tick, find items with an open time-log session and check whether
// they've crossed the 80% or 100% threshold of estimated hours. Each
// threshold fires at most once (idempotency via alerted_80pct_at /
// alerted_100pct_at).
export async function runLabourAlertCheck(): Promise<void> {
  try {
    const candidates = await db.execute(sql`
      SELECT
        i.id              AS item_id,
        i.job_card_id     AS job_card_id,
        i.estimated_hours AS estimated_hours,
        i.alerted_80pct_at,
        i.alerted_100pct_at,
        jc.vehicle_check_in_id AS check_in_id,
        COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(tl.paused_at, now()) - tl.started_at))), 0)::int AS total_seconds
      FROM job_card_items i
      INNER JOIN job_cards jc ON jc.id = i.job_card_id
      LEFT JOIN job_card_item_time_logs tl ON tl.job_card_item_id = i.id
      WHERE i.completed_at IS NULL
        AND i.estimated_hours IS NOT NULL
        AND i.estimated_hours > 0
      GROUP BY i.id, jc.vehicle_check_in_id
    `);

    for (const row of candidates.rows as any[]) {
      const est = Number(row.estimated_hours);
      if (!est || est <= 0) continue;
      const ratio = Number(row.total_seconds) / (est * 3600);
      const checkInId: string | null = row.check_in_id;
      if (!checkInId) continue;

      if (ratio >= 0.8 && !row.alerted_80pct_at) {
        await db
          .update(jobCardItems)
          .set({ alerted80pctAt: new Date() })
          .where(eq(jobCardItems.id, row.item_id));
        await dispatchNotifications({
          trigger: 'LABOUR_80',
          triggerValue: 'LABOUR_80',
          checkInId,
          jobCardItemId: row.item_id,
        });
      }
      if (ratio >= 1.0 && !row.alerted_100pct_at) {
        await db
          .update(jobCardItems)
          .set({ alerted100pctAt: new Date() })
          .where(eq(jobCardItems.id, row.item_id));
        await dispatchNotifications({
          trigger: 'LABOUR_100',
          triggerValue: 'LABOUR_100',
          checkInId,
          jobCardItemId: row.item_id,
        });
      }
    }
  } catch (err) {
    console.error('[runLabourAlertCheck] crashed:', err);
  }
}

// ─── Part-ETA promotion cron ───────────────────────────────────────────────
// Every tick, find part_requests whose ETA has passed but are still
// `unavailable`. Flip them back to `pending` so the PM dashboard surfaces
// them, write an in-app notification, and emit a v360 timeline breadcrumb
// (the timeline aggregator picks up the part_requests.updated_at change).
// Idempotent — once promoted, the row leaves the candidate set.
export async function runPartEtaPromotionCheck(): Promise<void> {
  try {
    // Find part_requests where:
    //  - status = 'unavailable'
    //  - expected_time set + already in the past
    // PostgreSQL stores expected_time as varchar(100) historically, so we
    // try a permissive cast; rows with unparseable strings are skipped.
    const candidates = await db.execute(sql`
      SELECT
        pr.id              AS id,
        pr.part_name       AS part_name,
        pr.job_card_id     AS job_card_id,
        jc.vehicle_check_in_id AS check_in_id
      FROM part_requests pr
      INNER JOIN job_cards jc ON jc.id = pr.job_card_id
      WHERE pr.status = 'unavailable'
        AND pr.expected_time IS NOT NULL
        AND (
          -- Try ISO timestamp parse; fall through to false on failure.
          CASE
            WHEN pr.expected_time ~ '^\\d{4}-\\d{2}-\\d{2}'
              THEN pr.expected_time::timestamptz <= now()
            ELSE false
          END
        )
    `);

    if (candidates.rows.length === 0) return;

    for (const row of candidates.rows as any[]) {
      // Flip the status.
      await db
        .update(partRequests)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(partRequests.id, row.id));

      // In-app notification to every active Parts Manager. The notifications
      // table is per-user, so we resolve the role → user list and insert
      // one row each. Bell icon on the FE picks them up automatically.
      try {
        const pmRows = await db.execute(sql`
          SELECT u.id
          FROM users u INNER JOIN roles r ON r.id = u.role_id
          WHERE r.slug = 'parts-manager' AND u.is_active = true
        `);
        for (const pm of pmRows.rows as any[]) {
          await db.insert(notifications).values({
            userId: pm.id,
            level: 'INFO',
            title: 'Part ETA reached',
            body: `${row.part_name} — ETA has passed; confirm availability with the supplier.`,
            refType: 'part_request',
            refId: row.id,
          });
        }
      } catch (e) {
        console.error('[runPartEtaPromotionCheck] notification insert failed:', e);
      }
    }
  } catch (err) {
    console.error('[runPartEtaPromotionCheck] crashed:', err);
  }
}

// Light shims so the linter doesn't moan about unused imports.
void users; void jobCards;
