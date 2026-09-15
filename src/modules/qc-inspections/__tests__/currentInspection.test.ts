import { describe, it, expect } from 'vitest';
import {
  pickCurrentInspection,
  isLiveInspectionStatus,
  CURRENT_INSPECTION_ORDER_BY,
  type InspectionCandidate,
} from '../currentInspection';

/**
 * QC queue: which inspection a row carries.
 *
 * The defect: `vehicle_check_ins → qc_inspections` is one-to-many, and the
 * queue joined on vehicle_check_in_id alone. A vehicle whose earlier inspection
 * had completed and which was being re-inspected produced two queue rows, and
 * the one shown could carry the COMPLETED inspection's id — so the card read
 * "Inspection (Draft)" while Resume opened a finished inspection whose every
 * write the server rejected with "must be IN_PROGRESS".
 *
 * These are pure-function tests over the same rule the query's correlated
 * subquery applies (both share CURRENT_INSPECTION_ORDER_BY). There is no
 * DB-backed test harness in this project, so they lock the selection RULE, not
 * the SQL execution — matching the style of the sibling bayAvailability /
 * bayReallocation suites.
 */

const insp = (
  id: string,
  status: string,
  startedAt: string | null = null,
  createdAt: string | null = '2026-01-01T00:00:00.000Z',
): InspectionCandidate => ({ id, status, startedAt, createdAt });

describe('isLiveInspectionStatus (what counts as still open)', () => {
  // Mirrors createInspection's guard: anything not COMPLETED blocks a new one.
  it('treats PENDING and IN_PROGRESS as live', () => {
    expect(isLiveInspectionStatus('PENDING')).toBe(true);
    expect(isLiveInspectionStatus('IN_PROGRESS')).toBe(true);
  });

  it('treats COMPLETED as not live', () => {
    expect(isLiveInspectionStatus('COMPLETED')).toBe(false);
  });

  it('treats a missing status as not live', () => {
    expect(isLiveInspectionStatus(null)).toBe(false);
    expect(isLiveInspectionStatus(undefined)).toBe(false);
  });
});

describe('pickCurrentInspection', () => {
  // Case 5 — no inspection at all.
  it('returns null when the check-in has no inspections', () => {
    expect(pickCurrentInspection([])).toBeNull();
  });

  // Case 1 — only a completed inspection: it is still the one to show, so the
  // registration link opens the last report.
  it('returns the only inspection when it is completed', () => {
    const only = insp('a', 'COMPLETED', '2026-08-22T16:33:00.000Z');
    expect(pickCurrentInspection([only])?.id).toBe('a');
  });

  // Case 2 — the reported defect. A live inspection must win over a completed
  // one even though the completed one may be newer.
  it('prefers a live inspection over a completed one', () => {
    const completed = insp('completed', 'COMPLETED', '2026-08-22T16:33:00.000Z');
    const live = insp('live', 'IN_PROGRESS', '2026-08-20T09:00:00.000Z');
    expect(pickCurrentInspection([completed, live])?.id).toBe('live');
  });

  it('prefers a live inspection regardless of input order', () => {
    const completed = insp('completed', 'COMPLETED', '2026-08-22T16:33:00.000Z');
    const live = insp('live', 'PENDING', '2026-08-20T09:00:00.000Z');
    expect(pickCurrentInspection([live, completed])?.id).toBe('live');
  });

  // Case 3 — multiple live inspections. createInspection should prevent this,
  // but the selection must still be deterministic if the data ever gets there.
  it('picks the newest when several are live', () => {
    const older = insp('older', 'IN_PROGRESS', '2026-08-20T09:00:00.000Z');
    const newer = insp('newer', 'PENDING', '2026-08-21T09:00:00.000Z');
    expect(pickCurrentInspection([older, newer])?.id).toBe('newer');
    expect(pickCurrentInspection([newer, older])?.id).toBe('newer');
  });

  // Case 4 — several completed inspections: the latest visit's report.
  it('picks the newest when all are completed', () => {
    const first = insp('first', 'COMPLETED', '2026-06-01T10:00:00.000Z');
    const second = insp('second', 'COMPLETED', '2026-07-01T10:00:00.000Z');
    const third = insp('third', 'COMPLETED', '2026-08-01T10:00:00.000Z');
    expect(pickCurrentInspection([first, third, second])?.id).toBe('third');
  });

  it('falls back to createdAt when startedAt is null', () => {
    // A PENDING inspection has no started_at yet, so COALESCE uses created_at.
    const older = insp('older', 'PENDING', null, '2026-08-01T10:00:00.000Z');
    const newer = insp('newer', 'PENDING', null, '2026-08-05T10:00:00.000Z');
    expect(pickCurrentInspection([older, newer])?.id).toBe('newer');
  });

  it('prefers startedAt over createdAt when both are present', () => {
    // Created first but started later — started_at decides, as in the SQL.
    const a = insp('a', 'COMPLETED', '2026-08-10T10:00:00.000Z', '2026-08-01T00:00:00.000Z');
    const b = insp('b', 'COMPLETED', '2026-08-02T10:00:00.000Z', '2026-08-09T00:00:00.000Z');
    expect(pickCurrentInspection([a, b])?.id).toBe('a');
  });

  it('breaks exact timestamp ties on id, descending', () => {
    const same = '2026-08-22T16:33:00.000Z';
    const a = insp('aaa', 'COMPLETED', same);
    const b = insp('bbb', 'COMPLETED', same);
    expect(pickCurrentInspection([a, b])?.id).toBe('bbb');
    expect(pickCurrentInspection([b, a])?.id).toBe('bbb');
  });

  it('is stable — repeated calls on the same set agree', () => {
    const set = [
      insp('x', 'COMPLETED', '2026-08-22T16:33:00.000Z'),
      insp('y', 'IN_PROGRESS', '2026-08-20T09:00:00.000Z'),
      insp('z', 'COMPLETED', '2026-08-25T09:00:00.000Z'),
    ];
    const first = pickCurrentInspection(set)?.id;
    expect(pickCurrentInspection([...set].reverse())?.id).toBe(first);
    expect(first).toBe('y');
  });

  // Case 6 — per-vehicle resolution. The SQL is a correlated subquery, so each
  // queue row resolves its own inspection; this asserts the rule does not leak
  // one vehicle's choice onto another.
  it('resolves each check-in independently', () => {
    const vehicleA = [
      insp('a-completed', 'COMPLETED', '2026-08-22T16:33:00.000Z'),
      insp('a-live', 'IN_PROGRESS', '2026-08-20T09:00:00.000Z'),
    ];
    const vehicleB = [insp('b-completed', 'COMPLETED', '2026-08-21T10:00:00.000Z')];
    const vehicleC: InspectionCandidate[] = [];

    expect(pickCurrentInspection(vehicleA)?.id).toBe('a-live');
    expect(pickCurrentInspection(vehicleB)?.id).toBe('b-completed');
    expect(pickCurrentInspection(vehicleC)).toBeNull();
  });

  // The GJ05SK4764 shape, without hardcoding that vehicle or its ids: a
  // completed inspection alongside the live one the card's status implies.
  it('regression: a re-inspected vehicle resolves to its live inspection', () => {
    const rows = [
      insp('finished-visit', 'COMPLETED', '2026-08-22T16:33:00.000Z'),
      insp('current-visit', 'IN_PROGRESS', '2026-08-26T09:00:00.000Z'),
    ];
    const picked = pickCurrentInspection(rows);
    expect(picked?.id).toBe('current-visit');
    expect(picked?.status).toBe('IN_PROGRESS');
  });
});

describe('CURRENT_INSPECTION_ORDER_BY (shared with the queue subquery)', () => {
  it('sorts live inspections first', () => {
    expect(CURRENT_INSPECTION_ORDER_BY).toContain("(qi.status <> 'COMPLETED') DESC");
  });

  it('then newest, falling back to created_at', () => {
    expect(CURRENT_INSPECTION_ORDER_BY).toContain(
      'COALESCE(qi.started_at, qi.created_at) DESC',
    );
  });

  it('ends on a deterministic tie-break', () => {
    expect(CURRENT_INSPECTION_ORDER_BY.trimEnd().endsWith('qi.id DESC')).toBe(true);
  });
});
