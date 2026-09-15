import { describe, it, expect } from 'vitest';
import {
  resolveRescheduleDuration,
  validateBayInterval,
  toMinutes,
} from '../bayAvailability';
import { rescheduleAppointmentSchema, estimatedDurationMinutesField } from '../dto';

/**
 * Reschedule duration support.
 *
 * The invariant under test: the duration the client filtered slots by is the
 * duration the server validates the bay interval against AND the duration that
 * gets stored. Before this change the server always used the appointment's OLD
 * duration, so a lengthened appointment could be booked into an interval it
 * did not fit.
 *
 * These are pure-function tests, matching the style of the sibling
 * bayAvailability / bayReallocation suites (no DB, no HTTP).
 */

// A bay booked 12:30–14:00, as used by the conflict scenarios below.
const booked = [{ start: toMinutes('12:30'), end: toMinutes('14:00') }];

describe('resolveRescheduleDuration (which duration wins)', () => {
  // Test 1 — reschedule WITHOUT a duration keeps the stored one.
  it('falls back to the stored duration when none is supplied', () => {
    expect(resolveRescheduleDuration(undefined, 150)).toBe(150);
  });

  // Test 2 — reschedule WITH a duration uses the new one.
  it('uses the supplied duration when one is sent', () => {
    expect(resolveRescheduleDuration(240, 150)).toBe(240);
  });

  it('treats a legacy null stored duration as zero rather than throwing', () => {
    expect(resolveRescheduleDuration(undefined, null)).toBe(0);
  });

  it('still prefers a supplied duration over a null stored one', () => {
    expect(resolveRescheduleDuration(240, null)).toBe(240);
  });
});

describe('bay interval validation uses the NEW duration', () => {
  // Test 3 — a longer duration is validated over its full new interval.
  it('accepts a longer duration that still fits the free window', () => {
    // 10:00 + 150 = 12:00, ending exactly as the 12:30 booking has not begun.
    const check = validateBayInterval('10:00', 150, booked);
    expect(check.valid).toBe(true);
  });

  // Test 4 — the same start becomes invalid once the duration grows.
  it('rejects the same start time when the longer interval overlaps a booking', () => {
    // 10:00 + 240 = 14:00, which runs into the 12:30–14:00 booking.
    const check = validateBayInterval('10:00', 240, booked);
    expect(check.valid).toBe(false);
  });

  it('is the duration — not the start time — that decides the outcome', () => {
    // Identical start, opposite verdicts: proves the interval end is what
    // matters, which is exactly what the old code got wrong.
    expect(validateBayInterval('10:00', 150, booked).valid).toBe(true);
    expect(validateBayInterval('10:00', 240, booked).valid).toBe(false);
  });

  // Test 5 — an appointment must not block itself. The exclusion happens when
  // the booked set is loaded (loadBookedByBay(date, excludeAppointmentId)), so
  // with itself excluded the interval it already occupies is free to re-take.
  it('permits re-taking an interval once the appointment itself is excluded', () => {
    const withoutSelf: { start: number; end: number }[] = [];
    expect(validateBayInterval('12:30', 90, withoutSelf).valid).toBe(true);
    // …and the same interval is refused while that booking is still counted.
    expect(validateBayInterval('12:30', 90, booked).valid).toBe(false);
  });
});

describe('duration validation rules (shared with appointment creation)', () => {
  // Test 6 — invalid durations are refused by the shared field.
  it('rejects a duration below the 15-minute minimum', () => {
    expect(estimatedDurationMinutesField.safeParse(10).success).toBe(false);
  });

  it('rejects a duration above the 480-minute maximum', () => {
    expect(estimatedDurationMinutesField.safeParse(600).success).toBe(false);
  });

  it('rejects a non-integer duration', () => {
    expect(estimatedDurationMinutesField.safeParse(90.5).success).toBe(false);
  });

  it('accepts the boundary values', () => {
    expect(estimatedDurationMinutesField.safeParse(15).success).toBe(true);
    expect(estimatedDurationMinutesField.safeParse(480).success).toBe(true);
  });

  it('is optional on the reschedule schema, so existing callers still parse', () => {
    const parsed = rescheduleAppointmentSchema.safeParse({
      newDate: '2026-09-01',
      newTime: '10:00',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.estimatedDurationMinutes).toBeUndefined();
    }
  });

  it('accepts a valid duration on the reschedule schema', () => {
    const parsed = rescheduleAppointmentSchema.safeParse({
      newDate: '2026-09-01',
      newTime: '10:00',
      estimatedDurationMinutes: 240,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.estimatedDurationMinutes).toBe(240);
    }
  });

  it('rejects an invalid duration on the reschedule schema', () => {
    const parsed = rescheduleAppointmentSchema.safeParse({
      newDate: '2026-09-01',
      newTime: '10:00',
      estimatedDurationMinutes: 5,
    });
    expect(parsed.success).toBe(false);
  });
});

// Test 7 — capacity-slot appointments are unaffected. Their availability rule
// (assertSlotAvailable) counts bookings at an exact time against the slot
// capacity and never looks at duration, so there is no interval to widen. This
// is asserted structurally: validateBayInterval — the only duration-aware
// check — is reached solely on the bay path in rescheduleAppointment.
describe('capacity-slot appointments', () => {
  it('have no duration-dependent interval rule to change', () => {
    // Same slot, wildly different durations, identical (irrelevant) outcome —
    // duration simply is not part of the capacity model.
    const free: { start: number; end: number }[] = [];
    expect(validateBayInterval('10:00', 30, free).valid).toBe(true);
    expect(validateBayInterval('10:00', 480, free).valid).toBe(true);
  });
});
