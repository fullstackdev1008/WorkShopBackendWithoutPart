import { describe, it, expect } from 'vitest';
import {
  decideOdometerResult,
  MAX_ODOMETER,
  type OdometerVisionOutput,
} from '../odometerScan.dto';

/**
 * Odometer gates: confidence floor, integer coercion and a plausibility range.
 * The model is instructed to return null (with a reason) rather than guess when
 * it sees a trip meter or an unreadable cluster — these tests pin that the
 * server never turns such a response into a number.
 */

const base: OdometerVisionOutput = { odometer: 148230, confidence: 0.9, reason: null };

describe('decideOdometerResult', () => {
  it('accepts a confident, plausible reading', () => {
    const r = decideOdometerResult(base);
    expect(r.odometer).toBe(148230);
    expect(r.reason).toBeNull();
  });

  it('coerces a numeric string with separators', () => {
    expect(decideOdometerResult({ ...base, odometer: '148,230' }).odometer).toBe(148230);
    expect(decideOdometerResult({ ...base, odometer: '148 230' }).odometer).toBe(148230);
  });

  it('passes through the model reason when nothing was read', () => {
    // A trip-meter-only or unreadable cluster comes back as null + reason.
    const noOdo = decideOdometerResult({ odometer: null, confidence: 0.9, reason: 'NO_ODOMETER' });
    expect(noOdo.odometer).toBeNull();
    expect(noOdo.reason).toBe('NO_ODOMETER');

    const unreadable = decideOdometerResult({
      odometer: null,
      confidence: 0.9,
      reason: 'NOT_READABLE',
    });
    expect(unreadable.odometer).toBeNull();
    expect(unreadable.reason).toBe('NOT_READABLE');
  });

  it('rejects below the confidence floor', () => {
    const r = decideOdometerResult({ ...base, confidence: 0.5 });
    expect(r.odometer).toBeNull();
    expect(r.reason).toBe('LOW_CONFIDENCE');
  });

  it('rejects implausible values rather than accepting a misread', () => {
    expect(decideOdometerResult({ ...base, odometer: 0 }).reason).toBe('IMPLAUSIBLE_VALUE');
    expect(decideOdometerResult({ ...base, odometer: -5 }).reason).toBe('IMPLAUSIBLE_VALUE');
    expect(decideOdometerResult({ ...base, odometer: MAX_ODOMETER + 1 }).reason).toBe(
      'IMPLAUSIBLE_VALUE',
    );
  });

  it('accepts the range boundaries', () => {
    expect(decideOdometerResult({ ...base, odometer: 1 }).odometer).toBe(1);
    expect(decideOdometerResult({ ...base, odometer: MAX_ODOMETER }).odometer).toBe(MAX_ODOMETER);
  });

  it('rejects a non-numeric reading', () => {
    const r = decideOdometerResult({ ...base, odometer: 'not a number' });
    expect(r.odometer).toBeNull();
    expect(r.reason).not.toBeNull();
  });

  it('handles null/undefined vision output without throwing', () => {
    expect(decideOdometerResult(null).odometer).toBeNull();
    expect(decideOdometerResult(undefined).odometer).toBeNull();
  });
});
