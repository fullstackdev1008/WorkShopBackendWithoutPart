import { describe, it, expect } from 'vitest';
import {
  decidePlateResult,
  normalizePlate,
  validatePlate,
  type PlateVisionOutput,
} from '../plateScan.dto';

/**
 * South African number-plate gates.
 *
 * These are the decisions that stand between a raw vision reading and a vehicle
 * search, so they are tested without any network. The most important case is
 * the REGRESSION at the bottom: the reference (Indian-market) implementation
 * forces the last four characters of a plate to digits, which corrupts every SA
 * province-suffix plate (CWW326GP -> CWW3266P). That must never come back.
 */

const readable = (registration: string, confidence = 0.95): PlateVisionOutput => ({
  isPlate: true,
  readable: true,
  registration,
  confidence,
});

describe('normalizePlate / validatePlate — SA Tier-1 formats', () => {
  it('accepts a province-suffix plate', () => {
    expect(validatePlate(normalizePlate('CWW326GP'))).toBe(true);
  });

  it('strips spaces, hyphens and dots, and uppercases', () => {
    expect(normalizePlate('cww 326 gp')).toBe('CWW326GP');
    expect(normalizePlate('CWW-326-GP')).toBe('CWW326GP');
    expect(normalizePlate('C.W.W.326.GP')).toBe('CWW326GP');
  });

  it('accepts each supported province code', () => {
    for (const code of ['GP', 'MP', 'NW', 'FS', 'NC', 'EC', 'ZN', 'WP', 'L']) {
      const plate = `ABC123${code}`;
      expect(validatePlate(normalizePlate(plate)), plate).toBe(true);
    }
  });

  it('accepts Western Cape / KZN town-code plates', () => {
    expect(validatePlate(normalizePlate('CA123456'))).toBe(true);
    expect(validatePlate(normalizePlate('CJ54321'))).toBe(true);
    expect(validatePlate(normalizePlate('ND54321'))).toBe(true);
    expect(validatePlate(normalizePlate('CY9981'))).toBe(true);
  });

  it('rejects malformed registrations', () => {
    expect(validatePlate(normalizePlate('CWW32GP'))).toBe(false);   // too few digits
    expect(validatePlate(normalizePlate('326CWWGP'))).toBe(false);  // wrong order
    expect(validatePlate(normalizePlate('CWW326XX'))).toBe(false);  // unknown province
    expect(validatePlate(normalizePlate(''))).toBe(false);
    expect(validatePlate(normalizePlate(null))).toBe(false);
  });

  it('never rewrites a reading that is already valid', () => {
    expect(normalizePlate('CWW326GP')).toBe('CWW326GP');
    expect(normalizePlate('CA123456')).toBe('CA123456');
  });

  it('applies anchored OCR correction only where the scheme fixes the type', () => {
    // Letters misread as digits in the 3-letter head; digits misread as letters
    // in the 3-digit body. The province code is left alone.
    expect(normalizePlate('CWW3Z6GP')).toBe('CWW326GP'); // Z -> 2 in digit slot
    expect(normalizePlate('0WW326GP')).toBe('OWW326GP'); // 0 -> O in letter slot
  });

  it('REGRESSION: does not force the province suffix to digits', () => {
    // The Indian anchor would turn "…26GP" into "…266P" and then reject it.
    // Both rulesets now live side by side, so this must stay true.
    expect(normalizePlate('CWW326GP')).not.toBe('CWW3266P');
    expect(normalizePlate('CWW326GP')).toBe('CWW326GP');
  });
});

describe('normalizePlate / validatePlate — Indian schemes', () => {
  it('accepts standard state-scheme plates', () => {
    for (const plate of ['RJ14CV0002', 'GJ05AB1234', 'MH12DE1234', 'DL01AB1234', 'TN07B4123']) {
      expect(validatePlate(normalizePlate(plate)), plate).toBe(true);
    }
  });

  it('accepts BH (Bharat) series plates', () => {
    expect(validatePlate(normalizePlate('21BH2345AA'))).toBe(true);
    expect(validatePlate(normalizePlate('22BH1234A'))).toBe(true);
  });

  it('strips separators and uppercases', () => {
    expect(normalizePlate('rj 14 cv 0002')).toBe('RJ14CV0002');
    expect(normalizePlate('RJ-14-CV-0002')).toBe('RJ14CV0002');
  });

  it('never rewrites a reading that is already valid', () => {
    expect(normalizePlate('RJ14CV0002')).toBe('RJ14CV0002');
    expect(normalizePlate('21BH2345AA')).toBe('21BH2345AA');
  });

  it('applies the Indian anchors where the scheme fixes the type', () => {
    // State letters misread as digits; trailing unique number misread as letters.
    expect(normalizePlate('R114CV000Z')).toBe('RI14CV0002');
    expect(normalizePlate('8H14CV0002')).toBe('BH14CV0002');
  });

  it('rejects malformed Indian-looking registrations', () => {
    expect(validatePlate(normalizePlate('RJ14CV00'))).toBe(false);  // too few digits
    expect(validatePlate(normalizePlate('RJ14CV00021'))).toBe(false); // too long
  });
});

describe('the two markets do not corrupt each other', () => {
  it('every supported plate round-trips to itself', () => {
    for (const plate of [
      'CWW326GP', 'BJT418MP', 'DKR902NW', 'CA123456', 'ND54321', // SA
      'RJ14CV0002', 'GJ05AB1234', 'TN07B4123', '21BH2345AA',      // India
    ]) {
      expect(normalizePlate(plate), plate).toBe(plate);
      expect(validatePlate(plate), plate).toBe(true);
    }
  });
});

describe('decidePlateResult — gates', () => {
  it('accepts a confident, readable, valid plate', () => {
    const r = decidePlateResult(readable('CWW 326 GP'));
    expect(r).toEqual({
      isPlate: true,
      registration: 'CWW326GP',
      confidence: 0.95,
      reason: null,
    });
  });

  it('rejects when no plate was detected', () => {
    const r = decidePlateResult({
      isPlate: false,
      readable: false,
      registration: null,
      confidence: 0,
    });
    expect(r.reason).toBe('NO_NUMBER_PLATE_DETECTED');
    expect(r.registration).toBeNull();
  });

  it('rejects an unreadable plate', () => {
    const r = decidePlateResult({
      isPlate: true,
      readable: false,
      registration: null,
      confidence: 0.9,
    });
    expect(r.reason).toBe('PLATE_NOT_READABLE');
  });

  it('rejects a registration that matches no supported format', () => {
    // Not SA (no province code / wrong shape) and not Indian (no trailing
    // 4-digit block) — must not be forced to fit either scheme.
    expect(decidePlateResult(readable('XX99YY')).reason).toBe('INVALID_REGISTRATION');
    expect(decidePlateResult(readable('CWW326XX')).reason).toBe('INVALID_REGISTRATION');
  });

  it('rejects below the confidence floor', () => {
    expect(decidePlateResult(readable('CWW326GP', 0.5)).reason).toBe('LOW_CONFIDENCE');
  });

  it('rejects null/undefined vision output', () => {
    expect(decidePlateResult(null).reason).toBe('NO_NUMBER_PLATE_DETECTED');
    expect(decidePlateResult(undefined).reason).toBe('NO_NUMBER_PLATE_DETECTED');
  });
});
