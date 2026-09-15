import { describe, it, expect } from 'vitest';
import {
  findOverlappingBooking,
  selectAlternativeBays,
  toMinutes,
  type BayBooking,
} from '../bayAvailability';

// Helper builders
const booking = (id: string, start: string, end: string): BayBooking => ({
  appointmentId: id,
  startMin: toMinutes(start),
  endMin: toMinutes(end),
  appointmentTime: start,
  vehicleReg: null,
});
const bay = (id: string, isActive = true, extra: Partial<{ category: string | null }> = {}) => ({
  id,
  bayNo: id.toUpperCase(),
  category: extra.category ?? null,
  location: null,
  capabilities: null,
  isActive,
});

describe('findOverlappingBooking (displaced-appointment detection)', () => {
  const bookings = [booking('C', '11:00', '13:00')]; // Bay occupied 11:00–13:00
  it('detects overlap for a request that runs into the booking', () => {
    // A wants 10:00–12:00 → overlaps 11:00–13:00
    const clash = findOverlappingBooking(bookings, toMinutes('10:00'), toMinutes('12:00'));
    expect(clash?.appointmentId).toBe('C');
  });
  it('no overlap when the request ends exactly as the booking starts', () => {
    const clash = findOverlappingBooking(bookings, toMinutes('09:00'), toMinutes('11:00'));
    expect(clash).toBeNull();
  });
  it('no overlap when the request starts exactly as the booking ends', () => {
    const clash = findOverlappingBooking(bookings, toMinutes('13:00'), toMinutes('15:00'));
    expect(clash).toBeNull();
  });
  it('returns the earliest of multiple overlaps', () => {
    const many = [booking('B', '14:00', '15:00'), booking('A', '10:00', '11:00')];
    const clash = findOverlappingBooking(many, toMinutes('09:00'), toMinutes('16:00'));
    expect(clash?.appointmentId).toBe('A');
  });
});

describe('selectAlternativeBays (replacement for displaced appointment)', () => {
  // Displaced appointment C needs 10:00–12:00 (120 min).
  const start = toMinutes('10:00');
  const dur = 120;

  it('includes a fully-free active bay', () => {
    const alts = selectAlternativeBays([bay('bay2')], new Map(), start, dur);
    expect(alts.map((a) => a.id)).toEqual(['bay2']);
  });

  it('excludes a bay booked overlapping the required interval', () => {
    const occ = new Map([['bay2', [booking('x', '11:00', '13:00')]]]); // 10:00–12:00 clashes
    const alts = selectAlternativeBays([bay('bay2')], occ, start, dur);
    expect(alts).toEqual([]);
  });

  it('requires the FULL duration — a window ending too early is not offered', () => {
    // Bay free 07:00–11:00 then booked 11:00–20:00 → only a 1h window before 11:00.
    const occ = new Map([['bay2', [booking('x', '11:00', '20:00')]]]);
    const alts = selectAlternativeBays([bay('bay2')], occ, start, dur); // needs 10:00–12:00
    expect(alts).toEqual([]);
  });

  it('offers a bay whose free window fully contains the interval (partial-day booking)', () => {
    // Bay booked 07:00–10:00, free 10:00–20:00 → 10:00–12:00 fits.
    const occ = new Map([['bay2', [booking('x', '07:00', '10:00')]]]);
    const alts = selectAlternativeBays([bay('bay2')], occ, start, dur);
    expect(alts.map((a) => a.id)).toEqual(['bay2']);
  });

  it('excludes inactive bays', () => {
    const alts = selectAlternativeBays([bay('bay2', false)], new Map(), start, dur);
    expect(alts).toEqual([]);
  });

  it('excludes bays in excludeBayIds (e.g. the target bay)', () => {
    const alts = selectAlternativeBays([bay('bay2'), bay('bay3')], new Map(), start, dur, ['bay2']);
    expect(alts.map((a) => a.id)).toEqual(['bay3']);
  });

  it('excludes a start that runs past workshop closing (20:00)', () => {
    // 19:00 + 120 = 21:00 > 20:00 close → not offered even on a free bay.
    const alts = selectAlternativeBays([bay('bay2')], new Map(), toMinutes('19:00'), dur);
    expect(alts).toEqual([]);
  });

  it('returns multiple suitable bays for the foreman to choose', () => {
    const alts = selectAlternativeBays([bay('bay2'), bay('bay4'), bay('bay5')], new Map(), start, dur);
    expect(alts.map((a) => a.id).sort()).toEqual(['bay2', 'bay4', 'bay5']);
  });
});
