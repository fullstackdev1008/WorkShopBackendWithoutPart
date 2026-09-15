import { describe, it, expect } from 'vitest';
import { decideFuelResult, FUEL_LEVELS, type FuelVisionOutput } from '../fuelScan.dto';

/**
 * Fuel-gauge gates: the level must be one of the five the database enum allows,
 * and it must clear the confidence floor. The model is instructed to return a
 * reason rather than guess when it sees a speedo / RPM / temperature gauge, so
 * these tests pin that the server never turns such a response into a level.
 */

const base: FuelVisionOutput = { fuelLevel: 'HALF', confidence: 0.9, reason: null };

describe('decideFuelResult', () => {
  it('accepts a confident, valid level', () => {
    const r = decideFuelResult(base);
    expect(r.fuelLevel).toBe('HALF');
    expect(r.reason).toBeNull();
  });

  it('accepts every level the fuel_level enum allows', () => {
    for (const level of FUEL_LEVELS) {
      const r = decideFuelResult({ ...base, fuelLevel: level });
      expect(r.fuelLevel, level).toBe(level);
      expect(r.reason, level).toBeNull();
    }
  });

  it('rejects below the confidence floor', () => {
    const r = decideFuelResult({ ...base, confidence: 0.5 });
    expect(r.fuelLevel).toBeNull();
    expect(r.reason).toBe('LOW_CONFIDENCE');
  });

  it('passes through the model reason when no level was read', () => {
    for (const reason of ['NO_FUEL_GAUGE', 'NOT_A_FUEL_GAUGE', 'NOT_READABLE'] as const) {
      const r = decideFuelResult({ fuelLevel: null, confidence: 0.9, reason });
      expect(r.fuelLevel, reason).toBeNull();
      expect(r.reason, reason).toBe(reason);
    }
  });

  it('rejects a level outside the allowed set rather than coercing it', () => {
    // e.g. the model inventing "THREE_QUARTERS" or "0.5" — must not reach the DB.
    for (const bad of ['THREE_QUARTERS', 'half', '0.5', 'ONE_QUARTER', '']) {
      const r = decideFuelResult({ ...base, fuelLevel: bad });
      expect(r.fuelLevel, bad).toBeNull();
      expect(r.reason, bad).not.toBeNull();
    }
  });

  it('collapses an unknown reason to a safe default', () => {
    const r = decideFuelResult({ fuelLevel: null, confidence: 0.9, reason: 'SOMETHING_ELSE' });
    expect(r.fuelLevel).toBeNull();
    expect(r.reason).toBe('NO_FUEL_GAUGE');
  });

  it('handles null/undefined vision output without throwing', () => {
    expect(decideFuelResult(null).reason).toBe('PROCESSING_ERROR');
    expect(decideFuelResult(undefined).reason).toBe('PROCESSING_ERROR');
  });
});
