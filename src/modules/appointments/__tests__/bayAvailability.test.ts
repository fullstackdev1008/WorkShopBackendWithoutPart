import { describe, it, expect } from 'vitest';
import {
  toMinutes,
  fromMinutes,
  intervalsOverlap,
  mergeIntervals,
  freeWindows,
  durationFits,
  generateStartSlots,
  deriveStatus,
  validateBayInterval,
  WORKSHOP_OPEN,
  WORKSHOP_CLOSE,
} from '../bayAvailability';

const OPEN = toMinutes(WORKSHOP_OPEN);
const CLOSE = toMinutes(WORKSHOP_CLOSE);
const iv = (s: string, e: string) => ({ start: toMinutes(s), end: toMinutes(e) });

describe('time helpers', () => {
  it('round-trips HH:MM ↔ minutes', () => {
    expect(toMinutes('10:30')).toBe(630);
    expect(fromMinutes(630)).toBe('10:30');
    expect(fromMinutes(toMinutes('09:00'))).toBe('09:00');
  });
});

describe('intervalsOverlap (half-open [start,end))', () => {
  // Cases mirror the requirement's overlap matrix (§9).
  it('Case 1/6 — touching ends do NOT overlap', () => {
    expect(intervalsOverlap(toMinutes('12:00'), toMinutes('14:00'), toMinutes('10:00'), toMinutes('12:00'))).toBe(false);
  });
  it('Case 2 — partial overlap', () => {
    expect(intervalsOverlap(toMinutes('11:00'), toMinutes('13:00'), toMinutes('10:00'), toMinutes('12:00'))).toBe(true);
  });
  it('Case 3 — new contains existing', () => {
    expect(intervalsOverlap(toMinutes('10:00'), toMinutes('13:00'), toMinutes('11:00'), toMinutes('12:00'))).toBe(true);
  });
  it('Case 4 — new inside existing', () => {
    expect(intervalsOverlap(toMinutes('11:00'), toMinutes('12:00'), toMinutes('10:00'), toMinutes('14:00'))).toBe(true);
  });
  it('Case 5 — exact same period', () => {
    expect(intervalsOverlap(toMinutes('10:00'), toMinutes('12:00'), toMinutes('10:00'), toMinutes('12:00'))).toBe(true);
  });
  it('new ends exactly when existing starts — no overlap', () => {
    expect(intervalsOverlap(toMinutes('08:00'), toMinutes('10:00'), toMinutes('10:00'), toMinutes('12:00'))).toBe(false);
  });
});

describe('mergeIntervals', () => {
  it('coalesces overlapping and touching intervals', () => {
    const merged = mergeIntervals([iv('11:00', '13:00'), iv('10:00', '11:00'), iv('15:00', '16:00')]);
    expect(merged).toEqual([iv('10:00', '13:00'), iv('15:00', '16:00')]);
  });
});

describe('freeWindows', () => {
  it('subtracts a single mid-day booking (partial availability)', () => {
    const windows = freeWindows(toMinutes('09:00'), toMinutes('18:00'), [iv('11:00', '13:00')]);
    expect(windows).toEqual([iv('09:00', '11:00'), iv('13:00', '18:00')]);
  });
  it('returns whole operating window when nothing is booked', () => {
    const windows = freeWindows(OPEN, CLOSE, []);
    expect(windows).toEqual([{ start: OPEN, end: CLOSE }]);
  });
  it('returns nothing when fully booked', () => {
    const windows = freeWindows(OPEN, CLOSE, [{ start: OPEN, end: CLOSE }]);
    expect(windows).toEqual([]);
  });
  it('clips bookings that exceed operating hours', () => {
    const windows = freeWindows(toMinutes('09:00'), toMinutes('18:00'), [iv('08:00', '10:00')]);
    expect(windows).toEqual([iv('10:00', '18:00')]);
  });
});

describe('durationFits', () => {
  const windows = [iv('09:00', '11:00'), iv('13:00', '18:00')];
  it('fits inside a window', () => {
    expect(durationFits(toMinutes('14:00'), 120, windows)).toBe(true); // 14:00–16:00
  });
  it('rejects when it spills past a window into a booking', () => {
    expect(durationFits(toMinutes('10:00'), 120, windows)).toBe(false); // 10:00–12:00 crosses 11:00
  });
  it('allows a booking ending exactly at a window edge', () => {
    expect(durationFits(toMinutes('09:00'), 120, windows)).toBe(true); // 09:00–11:00
  });
  it('rejects a duration with no continuous window big enough (§13)', () => {
    const fragmented = [iv('09:00', '10:00'), iv('14:00', '15:00')];
    expect(durationFits(toMinutes('09:00'), 120, fragmented)).toBe(false);
  });
});

describe('generateStartSlots', () => {
  it('emits 30-min starts only where the interval fits', () => {
    const slots = generateStartSlots([iv('09:00', '10:30')], 30);
    expect(slots).toEqual(['09:00', '09:30', '10:00']); // 10:30 excluded (no 30 min after)
  });
});

describe('deriveStatus', () => {
  it('AVAILABLE when the full operating window is free', () => {
    expect(deriveStatus(true, OPEN, CLOSE, [{ start: OPEN, end: CLOSE }])).toBe('AVAILABLE');
  });
  it('PARTIALLY_AVAILABLE when there is a gap', () => {
    expect(deriveStatus(true, OPEN, CLOSE, [{ start: OPEN, end: toMinutes('11:00') }])).toBe('PARTIALLY_AVAILABLE');
  });
  it('FULLY_BOOKED when no free window', () => {
    expect(deriveStatus(true, OPEN, CLOSE, [])).toBe('FULLY_BOOKED');
  });
  it('OUT_OF_SERVICE when bay inactive', () => {
    expect(deriveStatus(false, OPEN, CLOSE, [{ start: OPEN, end: CLOSE }])).toBe('OUT_OF_SERVICE');
  });
});

describe('validateBayInterval (authoritative)', () => {
  const booked = [iv('11:00', '13:00')]; // one mid-day booking

  it('allows a fitting interval', () => {
    const r = validateBayInterval('13:00', 120, booked); // 13:00–15:00
    expect(r.valid).toBe(true);
    expect(r.endTime).toBe('15:00');
  });
  it('allows touching the end of a booking', () => {
    expect(validateBayInterval('09:00', 120, booked).valid).toBe(true); // 09:00–11:00
  });
  it('rejects an interval that spills into a booking (§8)', () => {
    const r = validateBayInterval('10:30', 120, booked); // 10:30–12:30 crosses 11:00
    expect(r.valid).toBe(false);
    expect(r.blockedAt).toBe('11:00');
  });
  it('rejects a start before opening', () => {
    const r = validateBayInterval('06:00', 60, []);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/opening/i);
  });
  it('rejects an end after closing (§10)', () => {
    const r = validateBayInterval('19:00', 120, []); // 19:00–21:00 > 20:00 close
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/operating hours/i);
  });
  it('allows ending exactly at closing', () => {
    expect(validateBayInterval('18:00', 120, []).valid).toBe(true); // 18:00–20:00 close
  });
});
