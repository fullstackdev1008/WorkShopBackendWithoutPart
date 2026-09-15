import { describe, it, expect } from 'vitest';
import {
  isEstimateAffecting,
  itemsHaveParts,
  isEditLocked,
  resolveEditOutcome,
  type EstimateItemSig,
} from '../jobCardEdit';

const item = (o: Partial<EstimateItemSig>): EstimateItemSig => ({
  jobDescription: 'Oil change',
  partsRequired: 'Oil filter',
  partsCost: 100,
  labourCost: 50,
  quantity: 1,
  ...o,
});

describe('isEstimateAffecting', () => {
  it('false when items and tax are unchanged', () => {
    const a = [item({}), item({ jobDescription: 'Brake', partsRequired: 'Pads' })];
    const b = [item({}), item({ jobDescription: 'Brake', partsRequired: 'Pads' })];
    expect(isEstimateAffecting(a, b, 15, 15)).toBe(false);
  });

  it('order-independent (reordered items are not a change)', () => {
    const a = [item({ jobDescription: 'A' }), item({ jobDescription: 'B' })];
    const b = [item({ jobDescription: 'B' }), item({ jobDescription: 'A' })];
    expect(isEstimateAffecting(a, b, 15, 15)).toBe(false);
  });

  it('true when a part cost changes', () => {
    expect(isEstimateAffecting([item({ partsCost: 100 })], [item({ partsCost: 120 })], 15, 15)).toBe(true);
  });
  it('true when labour cost changes', () => {
    expect(isEstimateAffecting([item({ labourCost: 50 })], [item({ labourCost: 75 })], 15, 15)).toBe(true);
  });
  it('true when quantity changes', () => {
    expect(isEstimateAffecting([item({ quantity: 1 })], [item({ quantity: 2 })], 15, 15)).toBe(true);
  });
  it('true when an operation (description) changes', () => {
    expect(isEstimateAffecting([item({ jobDescription: 'X' })], [item({ jobDescription: 'Y' })], 15, 15)).toBe(true);
  });
  it('true when an item is added or removed', () => {
    expect(isEstimateAffecting([item({})], [item({}), item({ jobDescription: 'Extra' })], 15, 15)).toBe(true);
  });
  it('true when tax percentage changes', () => {
    expect(isEstimateAffecting([item({})], [item({})], 15, 18)).toBe(true);
  });
  it('handles DB string numerics vs JS numbers', () => {
    const dbRow = [item({ partsCost: '100.00', labourCost: '50.00', quantity: '1' as any })];
    const jsRow = [item({ partsCost: 100, labourCost: 50, quantity: 1 })];
    expect(isEstimateAffecting(dbRow, jsRow, '15.00', 15)).toBe(false);
  });
});

describe('itemsHaveParts', () => {
  it('false for labour-only cards', () => {
    expect(itemsHaveParts([item({ partsRequired: 'LABOUR' }), item({ partsRequired: 'labour' })])).toBe(false);
  });
  it('false when partsRequired is empty/null', () => {
    expect(itemsHaveParts([item({ partsRequired: null }), item({ partsRequired: '' })])).toBe(false);
  });
  it('true when a real part is present', () => {
    expect(itemsHaveParts([item({ partsRequired: 'LABOUR' }), item({ partsRequired: 'Brake pads' })])).toBe(true);
  });
});

describe('isEditLocked', () => {
  it('locks once work has started or terminal', () => {
    for (const s of ['IN_PROGRESS', 'IN_SERVICE', 'FOREMAN_REVIEW', 'FOREMAN_REJECTED', 'COMPLETED', 'REJECTED']) {
      expect(isEditLocked(s)).toBe(true);
    }
  });
  it('allows editing through the estimate/approval phase', () => {
    for (const s of ['DRAFT', 'PENDING_PARTS', 'PARTS_CONFIRMED', 'SHARED', 'APPROVED', 'PARTIALLY_APPROVED', 'MODIFICATION_REQUESTED']) {
      expect(isEditLocked(s)).toBe(false);
    }
  });
});

describe('resolveEditOutcome', () => {
  // Scenario 7 — locked status validation
  it('locked status → locked outcome, no changes', () => {
    const o = resolveEditOutcome('IN_PROGRESS', true, true);
    expect(o.locked).toBe(true);
    expect(o.statusChanged).toBe(false);
    expect(o.regeneratePartRequests).toBe(false);
  });

  // Scenario 1 — edit without estimate impact
  it('non-affecting edit preserves everything', () => {
    for (const s of ['DRAFT', 'PENDING_PARTS', 'PARTS_CONFIRMED', 'SHARED', 'APPROVED']) {
      const o = resolveEditOutcome(s, false, true);
      expect(o).toMatchObject({
        locked: false,
        regeneratePartRequests: false,
        statusChanged: false,
        setReconfirmationFlag: false,
        invalidateApproval: false,
        targetStatus: s,
      });
    }
  });

  // Scenario 2 — edit with estimate impact, PARTS_CONFIRMED preserves status + flag
  it('PARTS_CONFIRMED + affecting + parts → status preserved, flag set, requests regenerated', () => {
    const o = resolveEditOutcome('PARTS_CONFIRMED', true, true);
    expect(o).toMatchObject({
      statusChanged: false,
      targetStatus: 'PARTS_CONFIRMED',
      setReconfirmationFlag: true,
      regeneratePartRequests: true, // Scenario 3 — auto regeneration
      invalidateApproval: false,
    });
  });

  it('PARTS_CONFIRMED + affecting + labour-only → no flag, no regeneration (nothing to reconfirm)', () => {
    const o = resolveEditOutcome('PARTS_CONFIRMED', true, false);
    expect(o).toMatchObject({ setReconfirmationFlag: false, regeneratePartRequests: false, statusChanged: false });
  });

  it('PENDING_PARTS + affecting + parts → preserved, regenerated', () => {
    const o = resolveEditOutcome('PENDING_PARTS', true, true);
    expect(o).toMatchObject({ targetStatus: 'PENDING_PARTS', statusChanged: false, regeneratePartRequests: true });
  });

  it('PENDING_PARTS + affecting + no parts → moves to PARTS_CONFIRMED (nothing to await)', () => {
    const o = resolveEditOutcome('PENDING_PARTS', true, false);
    expect(o).toMatchObject({ targetStatus: 'PARTS_CONFIRMED', statusChanged: true, regeneratePartRequests: false });
    expect(o.vehicleStatus).toBe('Job Card (Parts Approval Done)');
  });

  // Scenarios 3 + 6 — post-share regression + approval invalidation
  it('SHARED + affecting + parts → regress to PENDING_PARTS, invalidate approval, regenerate', () => {
    const o = resolveEditOutcome('SHARED', true, true);
    expect(o).toMatchObject({
      targetStatus: 'PENDING_PARTS',
      statusChanged: true,
      regeneratePartRequests: true,
      invalidateApproval: true,
      setReconfirmationFlag: false,
    });
    expect(o.vehicleStatus).toBe('Job Card (Pending Parts Approval)');
  });

  it('APPROVED + affecting + parts → regress to PENDING_PARTS + invalidate approval', () => {
    const o = resolveEditOutcome('APPROVED', true, true);
    expect(o).toMatchObject({ targetStatus: 'PENDING_PARTS', statusChanged: true, invalidateApproval: true });
  });

  it('PARTIALLY_APPROVED + affecting + labour-only → regress to PARTS_CONFIRMED + invalidate approval', () => {
    const o = resolveEditOutcome('PARTIALLY_APPROVED', true, false);
    expect(o).toMatchObject({
      targetStatus: 'PARTS_CONFIRMED',
      statusChanged: true,
      invalidateApproval: true,
      regeneratePartRequests: false,
    });
  });

  // R2 — no DRAFT reset for MODIFICATION_REQUESTED
  it('MODIFICATION_REQUESTED + affecting + parts → PENDING_PARTS (never DRAFT) + invalidate approval', () => {
    const o = resolveEditOutcome('MODIFICATION_REQUESTED', true, true);
    expect(o.targetStatus).toBe('PENDING_PARTS');
    expect(o.targetStatus).not.toBe('DRAFT');
    expect(o.invalidateApproval).toBe(true);
  });

  it('DRAFT + affecting → stays DRAFT, no regeneration (SA requests parts explicitly)', () => {
    const o = resolveEditOutcome('DRAFT', true, true);
    expect(o).toMatchObject({ targetStatus: 'DRAFT', statusChanged: false, regeneratePartRequests: false });
  });
});
