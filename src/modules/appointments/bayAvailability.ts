/**
 * Bay & Time-Slot availability — per-bay, duration-aware scheduling.
 *
 * The receptionist reserves a physical bay for [start, start+duration) on a
 * date. A bay is only bookable when the ENTIRE requested interval fits inside a
 * continuous free window within workshop operating hours — validating the start
 * time alone is never enough.
 *
 * The pure helpers below (no DB) hold all the interval math and are unit-tested;
 * the DB builders compose them with live appointment/bay data. Bay occupation
 * comes from bay-scheduled appointments (appointments.bay_id) whose window is
 * [appointmentTime, appointmentTime + estimatedDurationMinutes) — mirroring the
 * capacity-slot status filter (BOOKED/CONFIRMED/CHECKED_IN/IN_SERVICE), so a
 * CANCELLED / NO_SHOW / COMPLETED appointment frees the bay automatically.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db';
import { appointments } from '../../db/models/appointments';
import { workshopBays } from '../../db/models/workshopBays';
import { vehicles } from '../../db/models/vehicles';

// ─── Configurable business rules ──────────────────────────────────────────────
// No workshop operating-hours or per-bay slot-interval config exists in the
// system today, so these are the single source of truth. Change here to adjust.
export const WORKSHOP_OPEN = '07:00';
// Closing/last-finish time. Set to 20:00 so late-afternoon starts (e.g. 5:30 PM)
// can still fit a standard duration before the day ends.
export const WORKSHOP_CLOSE = '20:00';
export const SLOT_INTERVAL_MINUTES = 30;

// Appointment statuses that actively hold a bay (mirrors assertSlotAvailable).
const ACTIVE_STATUSES = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] as const;

export type BayAvailabilityStatus =
  | 'AVAILABLE'
  | 'PARTIALLY_AVAILABLE'
  | 'FULLY_BOOKED'
  | 'OUT_OF_SERVICE';

export interface TimeWindow {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}
export interface BookedWindow extends TimeWindow {
  reason: 'BOOKED';
  /**
   * Who holds this window. Without it a blocked slot is an unexplained red box —
   * users assume it is their own (just-moved) appointment still stuck there,
   * when it is usually a different vehicle. Null only if the join finds nothing.
   */
  bookingRef?: string | null;
  vehicleReg?: string | null;
}
export interface BayAvailability {
  id: string;
  bayNo: string;
  category: string | null;
  location: string | null;
  status: BayAvailabilityStatus;
  available: TimeWindow[];
  blocked: BookedWindow[];
}

// ─── Pure time helpers ────────────────────────────────────────────────────────

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Half-open overlap: [aStart,aEnd) vs [bStart,bEnd). Touching ends do NOT overlap. */
export function intervalsOverlap(
  aStart: number, aEnd: number, bStart: number, bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Merge + sort a set of intervals (in minutes), coalescing overlaps/touches. */
export function mergeIntervals(
  intervals: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** Operating window minus blocked intervals → free windows (minutes). */
export function freeWindows(
  openMin: number, closeMin: number,
  blocked: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const merged = mergeIntervals(
    blocked
      .map((b) => ({ start: Math.max(b.start, openMin), end: Math.min(b.end, closeMin) }))
      .filter((b) => b.end > b.start),
  );
  const windows: Array<{ start: number; end: number }> = [];
  let cursor = openMin;
  for (const b of merged) {
    if (b.start > cursor) windows.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < closeMin) windows.push({ start: cursor, end: closeMin });
  return windows;
}

/** Does [start, start+duration) fit fully inside one free window? */
export function durationFits(
  startMin: number, durationMin: number,
  windows: Array<{ start: number; end: number }>,
): boolean {
  const endMin = startMin + durationMin;
  return windows.some((w) => startMin >= w.start && endMin <= w.end);
}

/** Candidate start times (at the slot interval) where at least one interval fits. */
export function generateStartSlots(
  windows: Array<{ start: number; end: number }>,
  interval = SLOT_INTERVAL_MINUTES,
): string[] {
  const slots: string[] = [];
  for (const w of windows) {
    for (let t = w.start; t + interval <= w.end; t += interval) {
      slots.push(fromMinutes(t));
    }
  }
  return slots;
}

/** Derive a bay status from its free windows over the operating span. */
export function deriveStatus(
  isActive: boolean,
  openMin: number, closeMin: number,
  windows: Array<{ start: number; end: number }>,
): BayAvailabilityStatus {
  if (!isActive) return 'OUT_OF_SERVICE';
  const freeTotal = windows.reduce((sum, w) => sum + (w.end - w.start), 0);
  if (freeTotal <= 0) return 'FULLY_BOOKED';
  if (windows.length === 1 && windows[0].start <= openMin && windows[0].end >= closeMin) {
    return 'AVAILABLE';
  }
  return 'PARTIALLY_AVAILABLE';
}

export interface DurationValidation {
  valid: boolean;
  endTime: string;
  reason?: string;
  blockedAt?: string;
}

/**
 * Authoritative duration validation for a single bay. `booked` are the bay's
 * existing occupation windows (minutes). Checks operating hours + full-interval
 * fit against a continuous free window.
 */
export function validateBayInterval(
  startTime: string,
  durationMin: number,
  booked: Array<{ start: number; end: number }>,
  openMin = toMinutes(WORKSHOP_OPEN),
  closeMin = toMinutes(WORKSHOP_CLOSE),
): DurationValidation {
  const startMin = toMinutes(startTime);
  const endMin = startMin + durationMin;
  const endTime = fromMinutes(endMin);

  if (startMin < openMin) {
    return { valid: false, endTime, reason: 'The selected start time is before workshop opening.' };
  }
  if (endMin > closeMin) {
    return { valid: false, endTime, blockedAt: WORKSHOP_CLOSE, reason: 'The selected duration extends beyond workshop operating hours.' };
  }
  // Direct overlap check against each booked interval (authoritative).
  const clash = booked
    .filter((b) => intervalsOverlap(startMin, endMin, b.start, b.end))
    .sort((a, b) => a.start - b.start)[0];
  if (clash) {
    return {
      valid: false,
      endTime,
      blockedAt: fromMinutes(clash.start),
      reason: 'The selected Bay is not available for the complete estimated duration.',
    };
  }
  return { valid: true, endTime };
}

// ─── DB-backed builders ───────────────────────────────────────────────────────

/** One occupied interval plus who holds it. */
interface BookedInterval {
  start: number;
  end: number;
  bookingRef: string | null;
  vehicleReg: string | null;
}

/** All bay-scheduled occupation windows for a date, grouped by bayId. */
async function loadBookedByBay(
  date: string,
  excludeAppointmentId?: string,
): Promise<Map<string, BookedInterval[]>> {
  const conds = [
    eq(appointments.appointmentDate, date),
    inArray(appointments.status, [...ACTIVE_STATUSES]),
    isNull(appointments.deletedAt),
    sql`${appointments.bayId} IS NOT NULL`,
  ];
  if (excludeAppointmentId) conds.push(ne(appointments.id, excludeAppointmentId));

  const rows = await db
    .select({
      bayId: appointments.bayId,
      time: appointments.appointmentTime,
      duration: appointments.estimatedDurationMinutes,
      bookingRef: appointments.bookingRef,
      vehicleReg: vehicles.registrationNumber,
    })
    .from(appointments)
    .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(and(...conds));

  const map = new Map<string, BookedInterval[]>();
  for (const r of rows) {
    if (!r.bayId) continue;
    const start = toMinutes(r.time);
    const end = start + (r.duration ?? 0);
    const list = map.get(r.bayId) ?? [];
    list.push({ start, end, bookingRef: r.bookingRef, vehicleReg: r.vehicleReg ?? null });
    map.set(r.bayId, list);
  }
  return map;
}

/**
 * Per-bay availability for a date — the payload the receptionist UI renders.
 * `excludeAppointmentId` omits an appointment from its own occupation (edit).
 */
export async function getBayAvailabilityForDate(
  date: string,
  excludeAppointmentId?: string,
): Promise<{ operating: TimeWindow; slotIntervalMinutes: number; bays: BayAvailability[] }> {
  const openMin = toMinutes(WORKSHOP_OPEN);
  const closeMin = toMinutes(WORKSHOP_CLOSE);

  const bays = await db
    .select({
      id: workshopBays.id,
      bayNo: workshopBays.bayNo,
      category: workshopBays.category,
      location: workshopBays.location,
      isActive: workshopBays.isActive,
    })
    .from(workshopBays)
    .orderBy(workshopBays.bayNo);

  const bookedByBay = await loadBookedByBay(date, excludeAppointmentId);

  const result: BayAvailability[] = bays.map((bay) => {
    const booked = bay.isActive ? (bookedByBay.get(bay.id) ?? []) : [];
    const windows = bay.isActive ? freeWindows(openMin, closeMin, booked) : [];
    const status = deriveStatus(bay.isActive, openMin, closeMin, windows);
    return {
      id: bay.id,
      bayNo: bay.bayNo,
      category: bay.category ?? null,
      location: bay.location ?? null,
      status,
      available: windows.map((w) => ({ start: fromMinutes(w.start), end: fromMinutes(w.end) })),
      // NOT merged: merging would collapse adjacent bookings and lose which
      // vehicle holds which window. `available` (computed from the merged set
      // in freeWindows) still drives selectability — `blocked` is for display.
      blocked: booked
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((b) => ({
          start: fromMinutes(b.start),
          end: fromMinutes(b.end),
          reason: 'BOOKED' as const,
          bookingRef: b.bookingRef,
          vehicleReg: b.vehicleReg,
        })),
    };
  });

  return {
    operating: { start: WORKSHOP_OPEN, end: WORKSHOP_CLOSE },
    slotIntervalMinutes: SLOT_INTERVAL_MINUTES,
    bays: result,
  };
}

/**
 * Authoritative server-side conflict check for one bay booking. Returns an
 * error message string when the interval is NOT bookable, or null when it is.
 * Must be called inside the create/reschedule transaction (with the per-bay
 * advisory lock) so concurrent bookings can't both pass.
 */
/**
 * Which duration a reschedule should use — the single decision that keeps the
 * client's slot filtering, the server's conflict check and the stored value in
 * agreement.
 *
 * Supplying a duration means "use and persist this one"; omitting it means
 * "keep whatever the appointment already has" (the pre-existing behaviour).
 * The `?? 0` guard mirrors the rest of this module, where a null duration on a
 * legacy row is treated as a zero-length interval rather than throwing.
 */
export function resolveRescheduleDuration(
  supplied: number | undefined,
  existing: number | null | undefined,
): number {
  return supplied ?? existing ?? 0;
}

export async function checkBayIntervalConflict(
  bayId: string,
  date: string,
  startTime: string,
  durationMin: number,
  excludeAppointmentId?: string,
): Promise<string | null> {
  const [bay] = await db
    .select({ id: workshopBays.id, isActive: workshopBays.isActive })
    .from(workshopBays)
    .where(eq(workshopBays.id, bayId))
    .limit(1);
  if (!bay) return 'The selected Bay does not exist.';
  if (!bay.isActive) return 'The selected Bay is out of service.';

  const bookedByBay = await loadBookedByBay(date, excludeAppointmentId);
  const booked = bookedByBay.get(bayId) ?? [];
  const check = validateBayInterval(startTime, durationMin, booked);
  return check.valid ? null : (check.reason ?? 'The selected Bay is not available for the requested time.');
}

// ─── Foreman bay reallocation / displacement (Model A) ─────────────────────────
// All helpers below operate ONLY on appointments.bay_id — never on
// workshop_allocations (Model B). They power the foreman "change bay" + swap.

export interface BayBooking {
  appointmentId: string;
  startMin: number;
  endMin: number;
  appointmentTime: string; // "HH:MM"
  vehicleReg: string | null;
}

/** Active appointment occupation for a date, grouped by bayId (with appt + vehicle). */
export async function loadBayOccupancy(
  date: string,
  excludeAppointmentId?: string,
): Promise<Map<string, BayBooking[]>> {
  const conds = [
    eq(appointments.appointmentDate, date),
    inArray(appointments.status, [...ACTIVE_STATUSES]),
    isNull(appointments.deletedAt),
    sql`${appointments.bayId} IS NOT NULL`,
  ];
  if (excludeAppointmentId) conds.push(ne(appointments.id, excludeAppointmentId));

  const rows = await db
    .select({
      appointmentId: appointments.id,
      bayId: appointments.bayId,
      time: appointments.appointmentTime,
      duration: appointments.estimatedDurationMinutes,
      vehicleReg: vehicles.registrationNumber,
    })
    .from(appointments)
    .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(and(...conds));

  const map = new Map<string, BayBooking[]>();
  for (const r of rows) {
    if (!r.bayId) continue;
    const startMin = toMinutes(r.time);
    const list = map.get(r.bayId) ?? [];
    list.push({
      appointmentId: r.appointmentId,
      startMin,
      endMin: startMin + (r.duration ?? 0),
      appointmentTime: r.time,
      vehicleReg: r.vehicleReg ?? null,
    });
    map.set(r.bayId, list);
  }
  return map;
}

/** PURE — first booking overlapping [startMin, endMin), or null. */
export function findOverlappingBooking(
  bookings: BayBooking[],
  startMin: number,
  endMin: number,
): BayBooking | null {
  return (
    bookings
      .filter((b) => intervalsOverlap(startMin, endMin, b.startMin, b.endMin))
      .sort((a, b) => a.startMin - b.startMin)[0] ?? null
  );
}

export interface AlternativeBay {
  id: string;
  bayNo: string;
  category: string | null;
  location: string | null;
  capabilities: string[] | null;
  available: TimeWindow[];
}

interface BayRow {
  id: string;
  bayNo: string;
  category: string | null;
  location: string | null;
  capabilities: string[] | null;
  isActive: boolean;
}

/**
 * PURE — of the given ACTIVE bays, return those free for the ENTIRE
 * [startMin, startMin+durationMin) window (within operating hours), excluding
 * any bayIds in `excludeBayIds`. Reuses validateBayInterval for the fit check.
 */
export function selectAlternativeBays(
  bays: BayRow[],
  occupancy: Map<string, BayBooking[]>,
  startMin: number,
  durationMin: number,
  excludeBayIds: string[] = [],
): AlternativeBay[] {
  const openMin = toMinutes(WORKSHOP_OPEN);
  const closeMin = toMinutes(WORKSHOP_CLOSE);
  const startTime = fromMinutes(startMin);
  const exclude = new Set(excludeBayIds);
  const out: AlternativeBay[] = [];
  for (const bay of bays) {
    if (!bay.isActive || exclude.has(bay.id)) continue;
    const booked = (occupancy.get(bay.id) ?? []).map((b) => ({ start: b.startMin, end: b.endMin }));
    const check = validateBayInterval(startTime, durationMin, booked, openMin, closeMin);
    if (!check.valid) continue;
    const windows = freeWindows(openMin, closeMin, booked);
    out.push({
      id: bay.id,
      bayNo: bay.bayNo,
      category: bay.category,
      location: bay.location,
      capabilities: bay.capabilities,
      available: windows.map((w) => ({ start: fromMinutes(w.start), end: fromMinutes(w.end) })),
    });
  }
  return out;
}

/** DB — active bays suitable for [start, start+duration) on `date`. */
export async function findAlternativeBaysForInterval(
  date: string,
  startTime: string,
  durationMin: number,
  options: { excludeAppointmentId?: string; excludeBayIds?: string[]; category?: string | null } = {},
): Promise<AlternativeBay[]> {
  const bayRows = (await db
    .select({
      id: workshopBays.id,
      bayNo: workshopBays.bayNo,
      category: workshopBays.category,
      location: workshopBays.location,
      capabilities: workshopBays.capabilities,
      isActive: workshopBays.isActive,
    })
    .from(workshopBays)
    .where(
      options.category
        ? and(eq(workshopBays.isActive, true), eq(workshopBays.category, options.category as any))
        : eq(workshopBays.isActive, true),
    )
    .orderBy(workshopBays.bayNo)) as BayRow[];

  const occupancy = await loadBayOccupancy(date, options.excludeAppointmentId);
  return selectAlternativeBays(bayRows, occupancy, toMinutes(startTime), durationMin, options.excludeBayIds ?? []);
}

/** DB — the active appointment occupying `bayId` that clashes with the interval. */
export async function findConflictingAppointment(
  date: string,
  bayId: string,
  startTime: string,
  durationMin: number,
  excludeAppointmentId?: string,
): Promise<BayBooking | null> {
  const occupancy = await loadBayOccupancy(date, excludeAppointmentId);
  const startMin = toMinutes(startTime);
  return findOverlappingBooking(occupancy.get(bayId) ?? [], startMin, startMin + durationMin);
}

/**
 * DB — authoritative "is this bay free for the full interval" check, excluding a
 * set of appointment ids (e.g. the appointment being moved + the one leaving).
 * Returns an error message when NOT free, or null when free. Call INSIDE the
 * swap transaction after acquiring the per-bay advisory locks.
 */
export async function assertIntervalFree(
  date: string,
  bayId: string,
  startTime: string,
  durationMin: number,
  excludeAppointmentIds: string[] = [],
): Promise<string | null> {
  const [bay] = await db
    .select({ id: workshopBays.id, isActive: workshopBays.isActive })
    .from(workshopBays)
    .where(eq(workshopBays.id, bayId))
    .limit(1);
  if (!bay) return 'The selected Bay does not exist.';
  if (!bay.isActive) return 'The selected Bay is out of service.';

  const occupancy = await loadBayOccupancy(date);
  const exclude = new Set(excludeAppointmentIds);
  const booked = (occupancy.get(bayId) ?? [])
    .filter((b) => !exclude.has(b.appointmentId))
    .map((b) => ({ start: b.startMin, end: b.endMin }));
  const check = validateBayInterval(startTime, durationMin, booked);
  return check.valid ? null : (check.reason ?? 'The selected Bay is not available for the requested time.');
}
