import { describe, it, expect } from 'vitest';
import {
  toEvolvePhone,
  splitEvolvePhone,
  legacyZeroPhone,
  phoneSearchCandidates,
} from '../evolveIrm.service';

describe('toEvolvePhone — 27 canonical', () => {
  it('prefixes a bare national number with 27', () => {
    expect(toEvolvePhone('6833368')).toBe('276833368');
  });

  it('does NOT double-prefix a number already starting with 27', () => {
    expect(toEvolvePhone('276833368')).toBe('276833368');
  });

  it('strips a trunk 0 before prefixing (area-code number)', () => {
    expect(toEvolvePhone('0116833368')).toBe('27116833368');
  });

  it('normalises +27 / spaced / punctuated input to the same canonical form', () => {
    expect(toEvolvePhone('+27 68 3 3368')).toBe('276833368');
    expect(toEvolvePhone('27-6833368')).toBe('276833368');
  });

  it('returns empty for empty / undefined input', () => {
    expect(toEvolvePhone('')).toBe('');
    expect(toEvolvePhone(undefined)).toBe('');
  });
});

describe('splitEvolvePhone — Evolve CellphoneCode / CellphoneNumber', () => {
  it('splits 6833368 into code 27 + number 6833368', () => {
    expect(splitEvolvePhone('6833368')).toEqual({ code: '27', number: '6833368' });
  });

  it('is idempotent for an already-27 number', () => {
    expect(splitEvolvePhone('276833368')).toEqual({ code: '27', number: '6833368' });
  });

  it('recovers from a legacy "+27" code + trunk-0 number crammed together', () => {
    // legacy local row: countryCode "+27", contactNumber "0116833368"
    expect(splitEvolvePhone('0116833368')).toEqual({ code: '27', number: '116833368' });
  });

  it('returns blank fields for empty input', () => {
    expect(splitEvolvePhone('')).toEqual({ code: '', number: '' });
  });
});

describe('phoneSearchCandidates — dual search (no regression)', () => {
  it('offers BOTH the 27 form and the legacy 0 form', () => {
    expect(phoneSearchCandidates('6833368')).toEqual(['276833368', '06833368']);
  });

  it('for an area-code number, the 0 form matches native Evolve records', () => {
    // native ELT record stored as 011 / 6833368 → concat "0116833368"
    expect(phoneSearchCandidates('0116833368')).toEqual(['27116833368', '0116833368']);
  });

  it('de-dupes when both forms collapse to one', () => {
    // "27..." has no legacy 0 counterpart distinct enough to duplicate uselessly
    const c = phoneSearchCandidates('276833368');
    expect(c[0]).toBe('276833368');
    expect(new Set(c).size).toBe(c.length);
  });

  it('is empty for empty input', () => {
    expect(phoneSearchCandidates('')).toEqual([]);
  });
});

describe('legacyZeroPhone — retained secondary form', () => {
  it('keeps the leading 0 form', () => {
    expect(legacyZeroPhone('6833368')).toBe('06833368');
    expect(legacyZeroPhone('0116833368')).toBe('0116833368');
  });
});
