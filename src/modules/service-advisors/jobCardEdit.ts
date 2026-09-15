/**
 * Pure decision logic for "Edit Job Card after creation" (Option A).
 *
 * Kept free of DB/IO so it can be unit-tested directly. `updateJobCard`
 * consumes these to decide, for a given current status + whether the edit
 * affects the estimate + whether the (new) items include parts:
 *   - is editing locked?
 *   - did the estimate change?
 *   - must parts requests be regenerated / parts reconfirmed?
 *   - does the job card regress in lifecycle (never to DRAFT) and to what?
 *   - must the prior customer approval be invalidated?
 *
 * Design: job-card STATUS remains the single source of truth. Pre-share cases
 * preserve status (PARTS_CONFIRMED uses a reconfirmation flag to block Share);
 * post-share cases perform a controlled regression (never DRAFT) so the card
 * re-enters the existing parts→share→approve cycle.
 */

export type JobCardStatus =
  | 'DRAFT'
  | 'PENDING_PARTS'
  | 'PARTS_CONFIRMED'
  | 'SHARED'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'MODIFICATION_REQUESTED'
  | 'IN_PROGRESS'
  | 'IN_SERVICE'
  | 'FOREMAN_REVIEW'
  | 'FOREMAN_REJECTED'
  | 'COMPLETED';

// Editing is blocked once work has started or the card is terminal — rebuilding
// items would otherwise destroy technician assignments/time-logs/completion.
export const EDIT_LOCKED_STATUSES: JobCardStatus[] = [
  'IN_PROGRESS',
  'IN_SERVICE',
  'FOREMAN_REVIEW',
  'FOREMAN_REJECTED',
  'COMPLETED',
  'REJECTED',
];

export function isEditLocked(status: string): boolean {
  return (EDIT_LOCKED_STATUSES as string[]).includes(status);
}

// Paired vehicle.status for the job-card statuses this feature can transition to.
const VEHICLE_STATUS_FOR: Partial<Record<JobCardStatus, string>> = {
  PENDING_PARTS: 'Job Card (Pending Parts Approval)',
  PARTS_CONFIRMED: 'Job Card (Parts Approval Done)',
};

export interface EstimateItemSig {
  jobDescription: string | null;
  partsRequired: string | null;
  partsCost: number | string | null;
  labourCost: number | string | null;
  quantity: number | string | null;
}

/**
 * True when the edit changes costing or required parts. Compares the item set
 * (description, part, part cost, labour cost, quantity — order-independent) and
 * the tax percentage. Pure metadata changes return false.
 */
export function isEstimateAffecting(
  prevItems: EstimateItemSig[],
  nextItems: EstimateItemSig[],
  prevTaxPct: number | string | null,
  nextTaxPct: number | string | null,
): boolean {
  if (Number(prevTaxPct ?? 0) !== Number(nextTaxPct ?? 0)) return true;
  const norm = (arr: EstimateItemSig[]) =>
    arr
      .map((i) => ({
        d: (i.jobDescription ?? '').trim(),
        p: (i.partsRequired ?? '').trim().toUpperCase(),
        pc: Number(i.partsCost ?? 0) || 0,
        lc: Number(i.labourCost ?? 0) || 0,
        q: Number(i.quantity ?? 0) || 0,
      }))
      .sort(
        (a, b) =>
          (a.d + '|' + a.p).localeCompare(b.d + '|' + b.p) || a.pc - b.pc || a.lc - b.lc || a.q - b.q,
      );
  return JSON.stringify(norm(prevItems)) !== JSON.stringify(norm(nextItems));
}

/** Does the (new) item set include a real part (non-LABOUR partsRequired)? */
export function itemsHaveParts(items: EstimateItemSig[]): boolean {
  return items.some(
    (i) => i.partsRequired != null && String(i.partsRequired).trim() !== '' && String(i.partsRequired).trim().toUpperCase() !== 'LABOUR',
  );
}

export interface EditOutcome {
  locked: boolean;
  regeneratePartRequests: boolean;
  targetStatus: JobCardStatus;
  statusChanged: boolean;
  vehicleStatus: string | null; // paired vehicle status, only when statusChanged
  setReconfirmationFlag: boolean;
  invalidateApproval: boolean;
}

/**
 * Resolve the lifecycle outcome of an edit. `current` = job-card status before
 * the edit; `estimateAffected` from isEstimateAffecting; `hasParts` from
 * itemsHaveParts on the NEW items.
 */
export function resolveEditOutcome(
  current: string,
  estimateAffected: boolean,
  hasParts: boolean,
): EditOutcome {
  const status = current as JobCardStatus;
  const make = (o: Partial<EditOutcome>): EditOutcome => ({
    locked: false,
    regeneratePartRequests: false,
    targetStatus: status,
    statusChanged: false,
    vehicleStatus: null,
    setReconfirmationFlag: false,
    invalidateApproval: false,
    ...o,
  });

  if (isEditLocked(status)) return make({ locked: true });
  if (!estimateAffected) return make({}); // metadata-only: preserve everything

  const toStatus = (target: JobCardStatus, extra: Partial<EditOutcome>): EditOutcome => {
    const changed = target !== status;
    return make({
      targetStatus: target,
      statusChanged: changed,
      vehicleStatus: changed ? VEHICLE_STATUS_FOR[target] ?? null : null,
      ...extra,
    });
  };

  switch (status) {
    case 'DRAFT':
      // No confirmation existed; SA still requests parts explicitly later.
      return toStatus('DRAFT', {});
    case 'PENDING_PARTS':
      return hasParts
        ? toStatus('PENDING_PARTS', { regeneratePartRequests: true })
        : toStatus('PARTS_CONFIRMED', {}); // no parts left to await → shareable
    case 'PARTS_CONFIRMED':
      // Preserve status; block Share via the flag until re-confirmed.
      return hasParts
        ? toStatus('PARTS_CONFIRMED', { regeneratePartRequests: true, setReconfirmationFlag: true })
        : toStatus('PARTS_CONFIRMED', {}); // labour-only → nothing to reconfirm
    case 'SHARED':
    case 'APPROVED':
    case 'PARTIALLY_APPROVED':
    case 'MODIFICATION_REQUESTED':
      // Controlled regression + invalidate the prior customer approval. Never DRAFT.
      return hasParts
        ? toStatus('PENDING_PARTS', { regeneratePartRequests: true, invalidateApproval: true })
        : toStatus('PARTS_CONFIRMED', { invalidateApproval: true });
    default:
      // Any unforeseen status: preserve, do nothing risky.
      return make({});
  }
}
