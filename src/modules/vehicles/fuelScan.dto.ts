// ─── Fuel-Gauge Scan — DTO, validation & confidence gate ───────────────────────
//
// Pure logic for the Fuel-Gauge Vision auto-fill feature. No I/O here — the scan
// service handles the image + OpenAI call and delegates the decision to
// `decideFuelResult` so the gating is deterministic and testable.
//
// The model classifies the fuel gauge into one of five levels. This module never
// trusts the model blindly: an out-of-set value becomes null, low confidence is
// rejected, and an unknown reason collapses to PROCESSING_ERROR.

// ─── Fuel levels (must match the existing frontend/backend union) ──────────────
export const FUEL_LEVELS = ['EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL'] as const;
export type FuelLevel = (typeof FUEL_LEVELS)[number];

// ─── Rejection reasons ─────────────────────────────────────────────────────────
export const FUEL_REJECTION_REASONS = [
  'NO_FUEL_GAUGE',    // no gauge visible in the image
  'NOT_A_FUEL_GAUGE', // a gauge is present but it's a speedo/RPM/temp/battery/oil, not fuel
  'NOT_READABLE',     // fuel gauge present but blurry/dark/cropped/glare
  'LOW_CONFIDENCE',   // below the confidence threshold
  'PROCESSING_ERROR', // vision call / parse / upload failure
  'IMAGE_TOO_LARGE',  // request exceeded the 10 MB limit
  'UNSUPPORTED_FORMAT', // not jpeg / png / webp
] as const;

export type FuelRejectionReason = (typeof FUEL_REJECTION_REASONS)[number];

// ─── Result shape (also the API `data` contract) ───────────────────────────────
export interface FuelScanResult {
  fuelLevel: FuelLevel | null;
  confidence: number;
  reason: FuelRejectionReason | null;
}

// Raw, still-untrusted output parsed from the vision model.
export interface FuelVisionOutput {
  fuelLevel: string | null;
  confidence: number;
  reason: string | null;
}

// ─── Config ────────────────────────────────────────────────────────────────────
// Self-reported model confidence is a heuristic; below this floor we return null
// rather than guess a fuel level.
export const CONFIDENCE_THRESHOLD = 0.7;

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function isFuelLevel(v: unknown): v is FuelLevel {
  return typeof v === 'string' && (FUEL_LEVELS as readonly string[]).includes(v);
}

function isRejectionReason(v: unknown): v is FuelRejectionReason {
  return typeof v === 'string' && (FUEL_REJECTION_REASONS as readonly string[]).includes(v);
}

// ─── Uniform rejection helper ──────────────────────────────────────────────────
export function rejected(reason: FuelRejectionReason): FuelScanResult {
  return { fuelLevel: null, confidence: 0, reason };
}

// ─── Decision gate ──────────────────────────────────────────────────────────────
// Turns the raw vision output into the final, trustworthy result. Kept pure so
// it can be unit-tested without any network call.
export function decideFuelResult(vision: FuelVisionOutput | null | undefined): FuelScanResult {
  // Malformed / missing response → safe rejection.
  if (!vision || typeof vision !== 'object') return rejected('PROCESSING_ERROR');

  const confidence = clamp01(vision.confidence);

  // Model reported no usable fuel level.
  if (!isFuelLevel(vision.fuelLevel)) {
    // Prefer the model's own reason when it's a known one, else a safe default.
    const reason = isRejectionReason(vision.reason) ? vision.reason : 'NO_FUEL_GAUGE';
    return rejected(reason);
  }

  // A fuel level was returned — enforce the confidence floor.
  if (confidence < CONFIDENCE_THRESHOLD) return rejected('LOW_CONFIDENCE');

  // Accepted.
  return { fuelLevel: vision.fuelLevel, confidence, reason: null };
}
