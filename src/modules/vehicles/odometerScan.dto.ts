// ─── Odometer Scan — DTO, validation & confidence/plausibility gate ────────────
//
// Pure logic for the Odometer Vision auto-fill feature. No I/O here — the scan
// service handles the image + OpenAI call and delegates the decision to
// `decideOdometerResult` so the gating is deterministic and testable.
//
// The model reads the TOTAL odometer value. This module never trusts the model
// blindly: a non-numeric / out-of-range value becomes null, low confidence is
// rejected, and an unknown reason collapses to PROCESSING_ERROR.

// ─── Rejection reasons ─────────────────────────────────────────────────────────
export const ODOMETER_REJECTION_REASONS = [
  'NO_ODOMETER',        // no odometer reading visible
  'NOT_READABLE',       // odometer present but blurry/dark/cropped/glare
  'LOW_CONFIDENCE',     // below the confidence threshold
  'IMPLAUSIBLE_VALUE',  // parsed a number but it's out of a sane km range
  'PROCESSING_ERROR',   // vision call / parse / upload failure
  'IMAGE_TOO_LARGE',    // request exceeded the 10 MB limit
  'UNSUPPORTED_FORMAT', // not jpeg / png / webp
] as const;

export type OdometerRejectionReason = (typeof ODOMETER_REJECTION_REASONS)[number];

// ─── Result shape (also the API `data` contract) ───────────────────────────────
export interface OdometerScanResult {
  odometer: number | null;
  confidence: number;
  reason: OdometerRejectionReason | null;
}

// Raw, still-untrusted output parsed from the vision model.
export interface OdometerVisionOutput {
  odometer: number | string | null;
  confidence: number;
  reason: string | null;
}

// ─── Config ────────────────────────────────────────────────────────────────────
// Below this self-reported confidence we return null rather than guess a value.
export const CONFIDENCE_THRESHOLD = 0.7;

// Plausible total-odometer range (km). 0 is excluded to match the existing
// "> 0" field validation; upper bound guards against a misread giving a wild number.
export const MIN_ODOMETER = 1;
export const MAX_ODOMETER = 2_000_000;

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// Coerce the model's odometer field to a non-negative integer, or null. Accepts
// a number or a numeric string (stripping spaces / commas / dots used as
// thousands separators). Returns null for anything non-numeric.
function toInteger(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.round(v) : null;
  }
  if (typeof v === 'string') {
    const stripped = v.replace(/[\s,.]/g, '');
    if (!/^\d+$/.test(stripped)) return null;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isRejectionReason(v: unknown): v is OdometerRejectionReason {
  return typeof v === 'string' && (ODOMETER_REJECTION_REASONS as readonly string[]).includes(v);
}

// ─── Uniform rejection helper ──────────────────────────────────────────────────
export function rejected(reason: OdometerRejectionReason): OdometerScanResult {
  return { odometer: null, confidence: 0, reason };
}

// ─── Decision gate ──────────────────────────────────────────────────────────────
// Turns the raw vision output into the final, trustworthy result. Pure so it can
// be unit-tested (trip-meter / wrong-gauge / implausible / low-confidence cases)
// without any network call.
export function decideOdometerResult(vision: OdometerVisionOutput | null | undefined): OdometerScanResult {
  // Malformed / missing response → safe rejection.
  if (!vision || typeof vision !== 'object') return rejected('PROCESSING_ERROR');

  const confidence = clamp01(vision.confidence);
  const value = toInteger(vision.odometer);

  // Model reported no usable odometer value.
  if (value === null) {
    const reason = isRejectionReason(vision.reason) ? vision.reason : 'NO_ODOMETER';
    return rejected(reason);
  }

  // Plausibility guard.
  if (value < MIN_ODOMETER || value > MAX_ODOMETER) return rejected('IMPLAUSIBLE_VALUE');

  // Confidence floor.
  if (confidence < CONFIDENCE_THRESHOLD) return rejected('LOW_CONFIDENCE');

  return { odometer: value, confidence, reason: null };
}
