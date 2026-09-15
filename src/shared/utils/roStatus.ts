import { sql, eq, and, desc, isNotNull } from 'drizzle-orm';
import { db } from '../../db';
import { vehicleCheckIns, roStatusHistory, jobCards } from '../../db/models';
import { env } from '../../config/env';

// Canonical 15-state RO flow. Every transition writes one row to
// ro_status_history; ro_status on the check-in mirrors the latest value.
export const RO_STATUSES = [
  'ARRIVED',
  'QC_CHECK_IN',
  'IN_WORKSHOP',
  'DIAGNOSING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'WAITING_FOR_PARTS',
  'REPAIRS_STARTED',
  'QC_OUT',
  'QC_FAILED',
  'QC_PASSED',
  'WASHBAY',
  'READY_FOR_RELEASE',
  'RELEASED',
  'CLOSED',
] as const;
export type RoStatus = (typeof RO_STATUSES)[number];

// Friendly labels used anywhere we render the status to a human.
export const RO_STATUS_LABEL: Record<RoStatus, string> = {
  ARRIVED:           'Arrived',
  QC_CHECK_IN:       'QC Check-In',
  IN_WORKSHOP:       'In Workshop',
  DIAGNOSING:        'Diagnosing',
  AWAITING_APPROVAL: 'Awaiting Approval',
  APPROVED:          'Approved',
  WAITING_FOR_PARTS: 'Waiting for Parts',
  REPAIRS_STARTED:   'Repairs Started',
  QC_OUT:            'QC Out',
  QC_FAILED:         'QC Failed / Returned',
  QC_PASSED:         'QC Passed',
  WASHBAY:           'Washbay',
  READY_FOR_RELEASE: 'Ready for Release',
  RELEASED:          'Released',
  CLOSED:            'Closed',
};

// Generate the next RCV-NNNNN. Uses a Postgres sequence so it's monotonic
// across concurrent gate-entry confirms.
export async function generateReceivingNo(): Promise<string> {
  const result = await db.execute(sql`SELECT nextval('recv_seq') AS seq_val`);
  const seq = (result.rows[0] as any).seq_val;
  return `RCV-${String(Number(seq)).padStart(5, '0')}`;
}

// SINGLE chokepoint for moving the RO status. Anywhere that wants to
// advance the check-in's status MUST call this — never UPDATE the column
// directly — so the history stays complete and downstream hooks (WhatsApp
// templates, dashboards) can fire off this one place.
//
// No-ops when the check-in is already at `toStatus`. Returns the new status
// either way so callers can keep their flow uniform.
export async function setRoStatus(
  checkInId: string,
  toStatus: RoStatus,
  actorId: string | null,
  reason?: string,
): Promise<{ from: RoStatus | null; to: RoStatus; changed: boolean }> {
  const [current] = await db
    .select({ ro: vehicleCheckIns.roStatus })
    .from(vehicleCheckIns)
    .where(eq(vehicleCheckIns.id, checkInId))
    .limit(1);

  const from = (current?.ro ?? null) as RoStatus | null;
  if (from === toStatus) {
    return { from, to: toStatus, changed: false };
  }

  const now = new Date();
  await db.transaction(async (tx: any) => {
    await tx
      .update(vehicleCheckIns)
      .set({ roStatus: toStatus, roStatusAt: now, roStatusBy: actorId })
      .where(eq(vehicleCheckIns.id, checkInId));
    await tx.insert(roStatusHistory).values({
      checkInId,
      fromStatus: from ?? undefined,
      toStatus,
      at: now,
      byUserId: actorId,
      reason: reason ?? null,
    });
  });

  // Side-effect: vehicle leaves the workshop floor when it reaches QC_OUT
  // (or any later terminal-ish state). Free up the bay automatically so the
  // Foreman never has to remember. Dynamic import avoids a circular dep.
  const BAY_RELEASING = new Set<RoStatus>([
    'QC_OUT', 'QC_PASSED', 'QC_FAILED', 'WASHBAY',
    'READY_FOR_RELEASE', 'RELEASED', 'CLOSED',
  ]);
  if (BAY_RELEASING.has(toStatus)) {
    try {
      const mod = await import('../../modules/workshop/service');
      await mod.releaseAllocationForCheckIn(checkInId);
    } catch (err) {
      console.error('[setRoStatus] bay release failed:', err);
    }
  }

  // Side-effect: Phase 4 — dispatch notifications matching this transition.
  // Fire-and-forget; the dispatcher swallows its own errors.
  try {
    const mod = await import('../../modules/notifications/service');
    await mod.dispatchNotifications({
      trigger: 'RO_STATUS',
      triggerValue: toStatus,
      checkInId,
    });
    // QC_FAIL has its own trigger key so a separate rule set can broadcast
    // to manager / controllers without polluting the customer rules.
    if (toStatus === 'QC_FAILED') {
      await mod.dispatchNotifications({
        trigger: 'QC_FAIL',
        triggerValue: 'QC_FAILED',
        checkInId,
      });
    }
  } catch (err) {
    console.error('[setRoStatus] notification dispatch failed:', err);
  }

  // Side-effect: push the mapped Evolve ROStatus for this transition. Outbound
  // only — local ro_status remains the source of truth. Flag-gated and
  // fire-and-forget; dynamic import mirrors the workshop/notifications pattern
  // above and avoids any circular dependency. Never blocks setRoStatus.
  if (env.EVOLVE_JOB_CARD_SYNC_ENABLED) {
    try {
      const [jc] = await db
        .select({ id: jobCards.id })
        .from(jobCards)
        .where(and(eq(jobCards.vehicleCheckInId, checkInId), isNotNull(jobCards.evolveRoNumber)))
        .orderBy(desc(jobCards.updatedAt))
        .limit(1);
      if (jc) {
        const mod = await import('../../services/jobCardEvolveSync.service');
        void mod.syncJobCardUpdateToEvolve(jc.id).catch(() => { /* logged inside */ });
      }
    } catch (err) {
      console.error('[setRoStatus] Evolve status push failed:', err);
    }
  }

  return { from, to: toStatus, changed: true };
}
