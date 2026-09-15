import { describe, it, expect } from 'vitest';
import { resolveItemPrice, round2 } from '../priceOverride';

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(264.935)).toBe(264.94);
    expect(round2('100.5')).toBe(100.5);
    expect(round2(null)).toBe(0);
    expect(round2(undefined)).toBe(0);
  });
});

describe('resolveItemPrice — no override', () => {
  it('uses the Evolve price as the effective price', () => {
    const r = resolveItemPrice({ evolveUnitPrice: 264.93 });
    expect(r.evolveUnitPrice).toBe(264.93);
    expect(r.manualUnitPrice).toBeNull();
    expect(r.effectiveUnitPrice).toBe(264.93);
    expect(r.isPriceOverridden).toBe(false);
  });

  it('falls back to partsCost when no explicit evolve price is sent (backward compatible)', () => {
    const r = resolveItemPrice({ partsCost: 1352.85 });
    expect(r.evolveUnitPrice).toBe(1352.85);
    expect(r.effectiveUnitPrice).toBe(1352.85);
    expect(r.isPriceOverridden).toBe(false);
  });
});

describe('resolveItemPrice — with override', () => {
  it('manual price overrides the Evolve price (example from spec)', () => {
    const r = resolveItemPrice({ evolveUnitPrice: 264.93, manualUnitPrice: 270 });
    expect(r.evolveUnitPrice).toBe(264.93); // original preserved
    expect(r.manualUnitPrice).toBe(270);
    expect(r.effectiveUnitPrice).toBe(270); // used everywhere
    expect(r.isPriceOverridden).toBe(true);
  });

  it('accepts 0.00 as a valid manual override', () => {
    const r = resolveItemPrice({ evolveUnitPrice: 100, manualUnitPrice: 0 });
    expect(r.effectiveUnitPrice).toBe(0);
    expect(r.isPriceOverridden).toBe(true);
  });

  it('coerces string inputs and rounds to 2dp', () => {
    const r = resolveItemPrice({ evolveUnitPrice: '264.93', manualUnitPrice: '100.5' });
    expect(r.effectiveUnitPrice).toBe(100.5);
    expect(r.isPriceOverridden).toBe(true);
  });
});

describe('resolveItemPrice — cleared override reverts to Evolve', () => {
  it('null manual price reverts to the Evolve price and clears the flag', () => {
    const r = resolveItemPrice({ evolveUnitPrice: 264.93, manualUnitPrice: null });
    expect(r.manualUnitPrice).toBeNull();
    expect(r.effectiveUnitPrice).toBe(264.93);
    expect(r.isPriceOverridden).toBe(false);
  });

  it('empty-string manual price is treated as cleared', () => {
    const r = resolveItemPrice({ evolveUnitPrice: 264.93, manualUnitPrice: '' });
    expect(r.effectiveUnitPrice).toBe(264.93);
    expect(r.isPriceOverridden).toBe(false);
  });
});
