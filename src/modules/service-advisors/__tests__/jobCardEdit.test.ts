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

  // ── Parts-free workflow ────────────────────────────────────────────────────
  // An edit must never route a card into the Parts Manager. The single
  // exception is a LEGACY card already sitting in PENDING_PARTS.

  // Test 3 — editing a shared/approved parts card does not recreate the gate
  it('PARTS_CONFIRMED + affecting + parts → shareable, no flag, no regeneration', () => {
    const o = resolveEditOutcome('PARTS_CONFIRMED', true, true);
    expect(o).toMatchObject({
      statusChanged: false,
      targetStatus: 'PARTS_CONFIRMED',
      setReconfirmationFlag: false,
      regeneratePartRequests: false,
      invalidateApproval: false,
    });
  });

  it('PARTS_CONFIRMED + affecting + labour-only → no flag, no regeneration', () => {
    const o = resolveEditOutcome('PARTS_CONFIRMED', true, false);
    expect(o).toMatchObject({ setReconfirmationFlag: false, regeneratePartRequests: false, statusChanged: false });
  });

  // Test 4 — legacy PENDING_PARTS cards stay compatible with the old PM flow.
  // Editing FK-cascades the card's part_requests away, so when parts remain we
  // must regenerate them or the card is stranded (nothing for the PM to action,
  // and shareEstimate's legacy PENDING_PARTS guard blocks sharing forever).
  it('LEGACY PENDING_PARTS + affecting + parts → preserved, requests regenerated', () => {
    const o = resolveEditOutcome('PENDING_PARTS', true, true);
    expect(o).toMatchObject({ targetStatus: 'PENDING_PARTS', statusChanged: false, regeneratePartRequests: true });
  });

  it('LEGACY PENDING_PARTS + affecting + no parts → moves to PARTS_CONFIRMED (nothing to await)', () => {
    const o = resolveEditOutcome('PENDING_PARTS', true, false);
    expect(o).toMatchObject({ targetStatus: 'PARTS_CONFIRMED', statusChanged: true, regeneratePartRequests: false });
    expect(o.vehicleStatus).toBe('Job Card (Parts Approval Done)');
  });

  // Test 3 — post-share regression lands somewhere directly shareable, never
  // back in the Parts Manager queue. Approval still invalidated (the customer
  // approved different numbers).
  it('SHARED + affecting + parts → PARTS_CONFIRMED (shareable), invalidate approval, NO regeneration', () => {
    const o = resolveEditOutcome('SHARED', true, true);
    expect(o).toMatchObject({
      targetStatus: 'PARTS_CONFIRMED',
      statusChanged: true,
      regeneratePartRequests: false,
      invalidateApproval: true,
      setReconfirmationFlag: false,
    });
    expect(o.targetStatus).not.toBe('PENDING_PARTS');
    expect(o.vehicleStatus).toBe('Job Card (Parts Approval Done)');
  });

  it('APPROVED + affecting + parts → PARTS_CONFIRMED, invalidate approval, never PENDING_PARTS', () => {
    const o = resolveEditOutcome('APPROVED', true, true);
    expect(o).toMatchObject({
      targetStatus: 'PARTS_CONFIRMED',
      statusChanged: true,
      invalidateApproval: true,
      regeneratePartRequests: false,
    });
    expect(o.targetStatus).not.toBe('PENDING_PARTS');
  });

  it('PARTIALLY_APPROVED + affecting + labour-only → PARTS_CONFIRMED + invalidate approval', () => {
    const o = resolveEditOutcome('PARTIALLY_APPROVED', true, false);
    expect(o).toMatchObject({
      targetStatus: 'PARTS_CONFIRMED',
      statusChanged: true,
      invalidateApproval: true,
      regeneratePartRequests: false,
    });
  });

  // R2 — no DRAFT reset for MODIFICATION_REQUESTED
  it('MODIFICATION_REQUESTED + affecting + parts → PARTS_CONFIRMED (never DRAFT, never PENDING_PARTS)', () => {
    const o = resolveEditOutcome('MODIFICATION_REQUESTED', true, true);
    expect(o.targetStatus).toBe('PARTS_CONFIRMED');
    expect(o.targetStatus).not.toBe('DRAFT');
    expect(o.targetStatus).not.toBe('PENDING_PARTS');
    expect(o.invalidateApproval).toBe(true);
  });

  it('DRAFT + affecting + parts → stays DRAFT and directly shareable, no regeneration', () => {
    const o = resolveEditOutcome('DRAFT', true, true);
    expect(o).toMatchObject({ targetStatus: 'DRAFT', statusChanged: false, regeneratePartRequests: false });
  });

  // Test 2 — no editable pre-approval status can send a card to the Parts
  // Manager, and none sets the reconfirmation flag. PENDING_PARTS is excluded:
  // it is legacy-only and unreachable by cards created under this workflow.
  it('no non-legacy status can regress into PENDING_PARTS or set the reconfirmation flag', () => {
    const statuses = ['DRAFT', 'PARTS_CONFIRMED', 'SHARED', 'APPROVED', 'PARTIALLY_APPROVED', 'MODIFICATION_REQUESTED'];
    for (const s of statuses) {
      for (const hasParts of [true, false]) {
        const o = resolveEditOutcome(s, true, hasParts);
        expect(o.targetStatus, `${s} hasParts=${hasParts}`).not.toBe('PENDING_PARTS');
        expect(o.setReconfirmationFlag, `${s} hasParts=${hasParts}`).toBe(false);
        expect(o.regeneratePartRequests, `${s} hasParts=${hasParts}`).toBe(false);
      }
    }
  });

  // Test 1 / 6 — carrying parts must not change the outcome for any
  // non-legacy status. Parts are estimate data, not a workflow trigger.
  it('hasParts does not alter the outcome for any non-legacy status', () => {
    const statuses = ['DRAFT', 'PARTS_CONFIRMED', 'SHARED', 'APPROVED', 'PARTIALLY_APPROVED', 'MODIFICATION_REQUESTED'];
    for (const s of statuses) {
      expect(resolveEditOutcome(s, true, true), s).toEqual(resolveEditOutcome(s, true, false));
    }
  });
});
