import { describe, it, expect } from 'vitest';
import { decideLicenceResult, type LicenceVisionOutput } from '../licenceScan.dto';

/**
 * Driver-licence gates.
 *
 * The critical rule: a licence carries several numbers, and the national ID
 * must NEVER be surfaced as the Driver Licence #. The model returns them in
 * separate fields; `decideLicenceResult` compares them and drops the candidate
 * if they match. It also rejects date-shaped values.
 *
 * The result shape deliberately has no `idNumber` / `dates` — the national ID
 * is used only for the exclusion above and is then discarded, so it never
 * reaches the client.
 */

const base: LicenceVisionOutput = {
  isLicence: true,
  readable: true,
  name: 'MOKOENA T',
  licenceNumber: 'ABC1234567',
  idNumber: '9001015800086',
  dates: ['2019-04-01', '2029-04-01'],
  confidence: 0.9,
};

describe('decideLicenceResult — gates', () => {
  it('accepts a valid, confident, readable licence', () => {
    const r = decideLicenceResult(base);
    expect(r.isLicence).toBe(true);
    expect(r.name).toBe('MOKOENA T');
    expect(r.licenceNumber).toBe('ABC1234567');
    expect(r.reason).toBeNull();
  });

  it('never exposes the national ID or the dates', () => {
    // Via `unknown`: LicenceScanResult has no index signature, so TS rejects the
    // direct assertion. The point here is to inspect the shape at runtime.
    const r = decideLicenceResult(base) as unknown as Record<string, unknown>;
    expect(r).not.toHaveProperty('idNumber');
    expect(r).not.toHaveProperty('dates');
    expect(JSON.stringify(r)).not.toContain('9001015800086');
  });

  it('rejects an image that is not a licence', () => {
    const r = decideLicenceResult({ ...base, isLicence: false });
    expect(r.reason).toBe('NO_LICENCE_DETECTED');
    expect(r.name).toBeNull();
    expect(r.licenceNumber).toBeNull();
  });

  it('rejects an unreadable licence', () => {
    expect(decideLicenceResult({ ...base, readable: false }).reason).toBe('NOT_READABLE');
  });

  it('rejects below the confidence floor', () => {
    expect(decideLicenceResult({ ...base, confidence: 0.6 }).reason).toBe('LOW_CONFIDENCE');
  });

  it('rejects null/undefined vision output', () => {
    expect(decideLicenceResult(null).reason).toBe('NO_LICENCE_DETECTED');
    expect(decideLicenceResult(undefined).reason).toBe('NO_LICENCE_DETECTED');
  });
});

describe('decideLicenceResult — licence-number protection', () => {
  it('drops a licence number that is really the national ID', () => {
    const r = decideLicenceResult({ ...base, licenceNumber: '9001015800086' });
    expect(r.licenceNumber).toBeNull();
    expect(r.name).toBe('MOKOENA T'); // the rest of the read still stands
    expect(r.reason).toBeNull();
  });

  it('matches the national ID even when spacing/case differ', () => {
    const r = decideLicenceResult({
      ...base,
      licenceNumber: '900101 5800 086',
      idNumber: '9001015800086',
    });
    expect(r.licenceNumber).toBeNull();
  });

  it('drops a date-shaped licence number', () => {
    for (const d of ['2019-04-01', '01/04/2019', '01.04.19', '2020/12']) {
      expect(decideLicenceResult({ ...base, licenceNumber: d }).licenceNumber, d).toBeNull();
    }
  });

  it('drops implausibly short or long candidates', () => {
    expect(decideLicenceResult({ ...base, licenceNumber: 'AB1' }).licenceNumber).toBeNull();
    expect(
      decideLicenceResult({ ...base, licenceNumber: 'A'.repeat(26) }).licenceNumber,
    ).toBeNull();
  });

  it('returns null rather than guessing when the number is absent', () => {
    const r = decideLicenceResult({ ...base, licenceNumber: null });
    expect(r.licenceNumber).toBeNull();
    expect(r.name).toBe('MOKOENA T');
  });
});
