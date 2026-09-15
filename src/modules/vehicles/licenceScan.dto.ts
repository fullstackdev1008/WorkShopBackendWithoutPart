// ─── Driver-Licence Scan — DTO, parsing & licence-number protection ────────────
//
// Pure logic for the Gate Entry Capture-Driver-Licence OCR feature (any
// country). No I/O here — the scan service handles the image + OpenAI call and
// delegates the field decisions to `decideLicenceResult` below so the gating is
// deterministic and testable.
//
// CRITICAL: a driving licence carries several numbers (national ID / personal
// number, dates, etc.). Those must NEVER be used as the Driver Licence #. The
// model returns name / licenceNumber / idNumber / dates separately, and this
// module rejects date-shaped candidates and any candidate equal to the national
// ID / personal number before accepting a licence number.
//
// PRIVACY (differs from the reference implementation): the national ID and the
// parsed dates are used ONLY inside `decideLicenceResult` to exclude them from
// the licence number, and are then discarded. They are deliberately NOT part of
// `LicenceScanResult`, so a South African 13-digit ID number never crosses the
// network or reaches the client.

// ─── Rejection reasons ─────────────────────────────────────────────────────────
export const LICENCE_REJECTION_REASONS = [
  'NO_LICENCE_DETECTED', // image is not a driving licence (person/other doc/random)
  'NOT_READABLE',        // a licence is present but fields are not legible
  'LOW_CONFIDENCE',      // below the confidence threshold
  'PROCESSING_ERROR',    // vision call / parse / upload failure
  'IMAGE_TOO_LARGE',     // request exceeded the 10 MB limit
  'UNSUPPORTED_FORMAT',  // not jpeg / png / webp
] as const;

export type LicenceRejectionReason = (typeof LICENCE_REJECTION_REASONS)[number];

// ─── Result shape (also the API `data` contract) ───────────────────────────────
// No `idNumber` / `dates` — see the privacy note above.
export interface LicenceScanResult {
  isLicence: boolean;
  name: string | null;
  licenceNumber: string | null;
  confidence: number;
  reason: LicenceRejectionReason | null;
}

// Raw, still-untrusted output parsed from the vision model. This DOES carry the
// national ID and dates because the gates below need them to reject a licence
// number that is really an ID number or a date.
export interface LicenceVisionOutput {
  isLicence: boolean;
  readable: boolean;
  name: string | null;
  licenceNumber: string | null;
  idNumber: string | null;
  dates: string[];
  confidence: number;
}

// ─── Config ────────────────────────────────────────────────────────────────────
// Self-reported model confidence is a heuristic; the structural checks below are
// the real guard. Below this floor we return null rather than guess.
export const CONFIDENCE_THRESHOLD = 0.75;

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// Normalize for comparison: uppercase, strip spaces / dashes.
function normalizeNum(s: string): string {
  return s.replace(/[\s-]/g, '').toUpperCase();
}

// Date-shaped tokens we must never treat as a licence number, e.g.
// 2019-04-01, 01/04/2019, 01.04.19, 2020/12.
function looksLikeDate(s: string): boolean {
  const t = s.trim();
  return (
    /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?$/.test(t) || // 2019-04-01, 2020/12
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(t)     // 01-04-2019, 1/4/19
  );
}

// Is this a usable Driver Licence # candidate? Country-agnostic: rejects
// date-shaped values and obviously-too-short/long strings. Deliberately
// conservative — returns false rather than accept an ambiguous candidate.
// (The national-ID exclusion is applied in decideLicenceResult, which compares
// the candidate against the separately-returned idNumber.)
export function isValidLicenceNumber(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const t = candidate.trim();
  if (t.length < 4 || t.length > 25) return false;
  if (looksLikeDate(t)) return false; // reject dates
  // Must contain at least one alphanumeric char.
  return /[A-Za-z0-9]/.test(t);
}

// Light touch: trim + collapse inner whitespace. We do NOT correct/guess
// ambiguous characters for a licence number.
function tidy(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

// ─── Uniform rejection helper ──────────────────────────────────────────────────
export function rejected(reason: LicenceRejectionReason): LicenceScanResult {
  return {
    isLicence: false,
    name: null,
    licenceNumber: null,
    confidence: 0,
    reason,
  };
}

// ─── Decision gates ─────────────────────────────────────────────────────────────
// Turns the raw vision output into the final, trustworthy result. Kept pure so
// it can be unit-tested against ID-number / date confusion without any network.
export function decideLicenceResult(vision: LicenceVisionOutput | null | undefined): LicenceScanResult {
  // Gate 1 — detection. Not a driving licence → reject.
  if (!vision || vision.isLicence !== true) return rejected('NO_LICENCE_DETECTED');

  // Gate 2 — readability.
  if (vision.readable !== true) return rejected('NOT_READABLE');

  // Gate 3 — confidence floor. Below it we don't trust any extracted field.
  const confidence = clamp01(vision.confidence);
  if (confidence < CONFIDENCE_THRESHOLD) return rejected('LOW_CONFIDENCE');

  const name = tidy(vision.name);

  // Local-only: the national ID is read so it can be EXCLUDED below, then
  // dropped. It is never returned to the caller.
  const idNumber = tidy(vision.idNumber);

  // Licence number: prefer the model's explicit field, but only if it passes the
  // date / shape checks AND is not the national ID / personal number (compared
  // normalized to catch spacing/case differences). null rather than guess.
  const licCandidate = tidy(vision.licenceNumber);
  const sameAsId = !!(licCandidate && idNumber && normalizeNum(licCandidate) === normalizeNum(idNumber));
  const licenceNumber =
    licCandidate && isValidLicenceNumber(licCandidate) && !sameAsId ? licCandidate : null;

  return {
    isLicence: true,
    name,
    licenceNumber,
    confidence,
    reason: null,
  };
}
