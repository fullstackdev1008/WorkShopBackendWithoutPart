/**
 * Which QC inspection a queue row should carry.
 *
 * `vehicle_check_ins → qc_inspections` is one-to-many, so a check-in whose
 * earlier inspection completed and which is now being re-inspected has two
 * inspections. The dashboard queue must show exactly one, and it must be the
 * live one — otherwise the row reads "Inspection (Draft)" while Resume and the
 * registration link open a COMPLETED inspection that rejects every write.
 *
 * The priority is not invented here; it follows the rule already enforced by
 * `createInspection`, which refuses a new inspection while one exists with
 * `status != 'COMPLETED'`:
 *
 *   1. A live inspection (PENDING or IN_PROGRESS) wins. At most one can exist
 *      per vehicle, so this is unambiguous in practice.
 *   2. Otherwise the newest COMPLETED one, so a vehicle that has finished QC
 *      still opens its most recent report — matching how the ALL path already
 *      keeps only the latest completed inspection per vehicle.
 *   3. Ties break on id, so the choice is deterministic even when two rows
 *      share a timestamp.
 *
 * The ordering below is shared: the queue query interpolates
 * [CURRENT_INSPECTION_ORDER_BY] into its correlated subquery, and
 * [pickCurrentInspection] applies the identical rule in TypeScript so it can be
 * tested without a database (matching the pure-function style of the sibling
 * bayAvailability / bayReallocation suites).
 */

/** Statuses that mean "this inspection is still open for editing". */
export const LIVE_INSPECTION_STATUSES = ['PENDING', 'IN_PROGRESS'] as const;

export const isLiveInspectionStatus = (status: string | null | undefined): boolean =>
  status != null && status !== 'COMPLETED';

/**
 * ORDER BY for the correlated subquery that resolves one inspection per
 * check-in. Aliased `qi`. Kept as text so the query and the tested comparator
 * cannot drift apart.
 *
 * `(qi.status <> 'COMPLETED') DESC` sorts true (live) ahead of false, so a live
 * inspection outranks any completed one regardless of age.
 */
export const CURRENT_INSPECTION_ORDER_BY = `
      ORDER BY (qi.status <> 'COMPLETED') DESC,
               COALESCE(qi.started_at, qi.created_at) DESC,
               qi.id DESC`;

/** The subset of an inspection row the rule needs. */
export interface InspectionCandidate {
  id: string;
  status: string;
  startedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

const timeOf = (c: InspectionCandidate): number => {
  const raw = c.startedAt ?? c.createdAt ?? null;
  if (raw == null) return 0; // COALESCE(...) with both null sorts lowest
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * The inspection a queue row should show, or null when the check-in has none.
 *
 * Mirrors [CURRENT_INSPECTION_ORDER_BY] exactly. Pure — no ordering assumption
 * is made about the input.
 */
export function pickCurrentInspection<T extends InspectionCandidate>(
  candidates: readonly T[],
): T | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, c) => {
    // 1. live beats completed
    const bestLive = isLiveInspectionStatus(best.status);
    const cLive = isLiveInspectionStatus(c.status);
    if (cLive !== bestLive) return cLive ? c : best;

    // 2. newer beats older
    const bestTime = timeOf(best);
    const cTime = timeOf(c);
    if (cTime !== bestTime) return cTime > bestTime ? c : best;

    // 3. deterministic tie-break, DESC to match the SQL
    return c.id > best.id ? c : best;
  });
}
