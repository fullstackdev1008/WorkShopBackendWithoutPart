// ─── Number-Plate Scan — DTO, normalisation & validation gates (SA + INDIA) ────
//
// Pure logic for the Gate Entry Capture-Number-Plate feature. No I/O here — the
// scan service handles the image + OpenAI call and delegates every decision to
// `decidePlateResult` below so the gating is deterministic and unit-testable.
//
// HARD RULE: a vehicle search is only allowed when the returned result has
// `isPlate === true`, a valid `registration`, and `reason === null`. Every
// rejection collapses to the uniform "not a plate" shape so the client can
// simply check `reason === null` before searching. Generic OCR → search is
// never permitted.
//
// ─── WHY THIS FILE IS NOT A COPY OF THE REFERENCE IMPLEMENTATION ──────────────
// The reference (Indian-market) version anchors corrections on the assumption
// that the LAST FOUR characters of a plate are always digits. South African
// plates end in a PROVINCE CODE, so that rule actively corrupts them:
//
//   CWW326GP → last-4 window is "26GP" → toDigit('G') = '6' → CWW3266P
//
// …which then fails validation and is rejected. Every SA province-suffix plate
// would break. The scheme table and the correction anchors below are therefore
// written for South Africa; only the character-confusion maps are carried over.

// ─── Rejection reasons ─────────────────────────────────────────────────────────
export const PLATE_REJECTION_REASONS = [
  'NO_NUMBER_PLATE_DETECTED', // detector saw no plate (person/selfie/building/road/object/document/screenshot)
  'IMAGE_TOO_BLURRY',         // frame too blurry to read
  'IMAGE_TOO_DARK',           // frame too dark
  'PLATE_NOT_READABLE',       // a plate is present but its characters are not legible
  'INVALID_REGISTRATION',     // characters read but they fail the SA registration formats
  'LOW_CONFIDENCE',           // below the confidence threshold
  'PROCESSING_ERROR',         // vision call / parse / upload failure
  'IMAGE_TOO_LARGE',          // request exceeded the 10 MB limit
  'UNSUPPORTED_FORMAT',       // not jpeg / png / webp
] as const;

export type PlateRejectionReason = (typeof PLATE_REJECTION_REASONS)[number];

// ─── Result shapes (also the API `data` contract) ──────────────────────────────
export interface PlateScanResult {
  isPlate: boolean;
  registration: string | null;
  confidence: number;
  reason: PlateRejectionReason | null;
}

// Raw, still-untrusted output parsed from the vision model.
export interface PlateVisionOutput {
  isPlate: boolean;
  readable: boolean;
  registration: string | null;
  confidence: number;
}

// ─── Supported South African schemes (Tier 1) ─────────────────────────────────
// 1. Province-suffix   — 3 letters + 3 digits + province code   e.g. CWW326GP
// 2. Town-code series  — 2–3 letters + 3–6 digits               e.g. CA123456, ND54321
//
// Personalised/vanity plates, dealer, trailer, temporary, diplomatic and
// non-SA plates are intentionally NOT matched here — they are structurally
// unvalidatable and are rejected rather than guessed at.
export const SA_PROVINCE_CODES = ['GP', 'MP', 'NW', 'FS', 'NC', 'EC', 'ZN', 'WP', 'L'] as const;

// Longest-first so 'L' can never shadow a two-letter code during matching.
const PROVINCE_ALTERNATION = [...SA_PROVINCE_CODES]
  .sort((a, b) => b.length - a.length)
  .join('|');

export const SA_PROVINCE_PLATE_REGEX = new RegExp(`^[A-Z]{3}[0-9]{3}(?:${PROVINCE_ALTERNATION})$`);
export const SA_TOWN_PLATE_REGEX = /^[A-Z]{2,3}[0-9]{3,6}$/;

// ─── Supported Indian schemes ─────────────────────────────────────────────────
// Carried over from the reference implementation so the same build serves both
// markets:
//  - Standard state scheme  — GJ05AB1234, MH12DE1234, RJ14CV0002, TN07B4123
//  - BH (Bharat) series     — 21BH2345AA, 22BH1234A
// (Temporary / older single-letter series remain unsupported.)
export const INDIAN_PLATE_REGEX = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/;
export const BH_PLATE_REGEX = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;

// Self-reported model confidence is a heuristic — the strict format check above
// is the real guard. A plate must clear this floor before a search is allowed.
export const CONFIDENCE_THRESHOLD = 0.8;

// ─── Positional OCR correction ─────────────────────────────────────────────────
// Corrections are only ever applied to positions a scheme fixes as letters or
// digits, and only when the raw reading does NOT already validate — a plate the
// model read correctly is never rewritten. If the corrected string still fails
// validation it is rejected, not forced to fit.
const ALPHA_FIX: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '4': 'A', '5': 'S', '6': 'G', '8': 'B' };
const DIGIT_FIX: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', A: '4' };

const toAlpha = (c: string) => ALPHA_FIX[c] ?? c;
const toDigit = (c: string) => DIGIT_FIX[c] ?? c;

// Province-suffix anchors: LLL DDD <province>. The province code itself is left
// untouched — correcting it could silently move a vehicle to another province.
function correctProvinceScheme(s: string): string {
  const suffix = [...SA_PROVINCE_CODES].find((code) => s.endsWith(code));
  if (!suffix) return s;
  const body = s.slice(0, s.length - suffix.length);
  if (body.length !== 6) return s;

  const chars = body.split('');
  for (let i = 0; i < 3; i++) chars[i] = toAlpha(chars[i]);
  for (let i = 3; i < 6; i++) chars[i] = toDigit(chars[i]);
  return chars.join('') + suffix;
}

// Town-code anchors: leading letters, trailing digits. The split point is found
// by taking the longest leading run the scheme allows (3, then 2) that leaves a
// valid digit block behind.
function correctTownScheme(s: string): string {
  for (const letterCount of [3, 2]) {
    if (s.length <= letterCount) continue;
    const digits = s.length - letterCount;
    if (digits < 3 || digits > 6) continue;

    const chars = s.split('');
    for (let i = 0; i < letterCount; i++) chars[i] = toAlpha(chars[i]);
    for (let i = letterCount; i < chars.length; i++) chars[i] = toDigit(chars[i]);
    const candidate = chars.join('');
    if (SA_TOWN_PLATE_REGEX.test(candidate)) return candidate;
  }
  return s;
}

// ─── Indian anchors (from the reference implementation) ───────────────────────
// BH series puts the literal marker "BH" at positions 2-3. Detected on the
// alpha-corrected pair so an "8H" misread is still recognised as BH.
// Anchors: YY (digits) BH #### (digits) XX (letters).
function correctBhSeries(s: string): string {
  const out = s.split('');
  if (out.length < 9) return s;
  if (toAlpha(out[2]) !== 'B' || toAlpha(out[3]) !== 'H') return s;
  out[0] = toDigit(out[0]);
  out[1] = toDigit(out[1]);
  out[2] = 'B';
  out[3] = 'H';
  for (let i = 4; i < 8 && i < out.length; i++) out[i] = toDigit(out[i]);
  for (let i = 8; i < out.length; i++) out[i] = toAlpha(out[i]);
  return out.join('');
}

// Standard Indian anchors: the first two characters are always the state
// letters and the last four are always the unique number. The middle (RTO
// digits + series letters) is left untouched — its split cannot be known.
//
// NOTE this rule is INDIAN-ONLY and must never be applied to a South African
// plate: SA plates end in a province code, so forcing the last four characters
// to digits turns CWW326GP into CWW3266P. `normalizePlate` below keeps the
// schemes apart by only accepting a correction that actually validates.
function correctIndianStandard(s: string): string {
  const out = s.split('');
  for (let i = 0; i < 2 && i < out.length; i++) out[i] = toAlpha(out[i]);
  for (let i = out.length - 4; i < out.length; i++) {
    if (i >= 2) out[i] = toDigit(out[i]);
  }
  return out.join('');
}

// Uppercase, strip spaces / hyphens / dots (and any other separators), then
// apply the anchored positional corrections for the matching scheme.
export function normalizePlate(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw
    .toUpperCase()
    .replace(/[\s.\-]/g, '')    // spaces, dots, hyphens
    .replace(/[^A-Z0-9]/g, ''); // any other stray separators

  // Implausible length → return as-is so validation rejects it (no guesswork).
  // SA plates run 5–9 characters; Indian standard/BH run 8–10.
  if (s.length < 5 || s.length > 10) return s;

  // Already a valid registration → never "correct" a correct reading.
  if (validatePlate(s)) return s;

  // Try each scheme's anchored correction and accept the FIRST that yields a
  // genuinely valid registration. This is what keeps the markets apart without
  // having to guess the scheme up front: a correction that would corrupt a
  // plate (e.g. the Indian last-four-digits rule applied to CWW326GP) produces
  // something that fails validation, so it is discarded rather than returned.
  for (const candidate of [
    correctBhSeries(s),
    correctIndianStandard(s),
    correctProvinceScheme(s),
    correctTownScheme(s),
  ]) {
    if (validatePlate(candidate)) return candidate;
  }

  // Nothing produced a valid plate — hand back the raw reading so the caller
  // rejects it. Never force a candidate to fit.
  return s;
}

export function validatePlate(normalized: string): boolean {
  return (
    SA_PROVINCE_PLATE_REGEX.test(normalized) ||
    SA_TOWN_PLATE_REGEX.test(normalized) ||
    INDIAN_PLATE_REGEX.test(normalized) ||
    BH_PLATE_REGEX.test(normalized)
  );
}

// ─── Uniform rejection helper ──────────────────────────────────────────────────
export function rejected(reason: PlateRejectionReason): PlateScanResult {
  return { isPlate: false, registration: null, confidence: 0, reason };
}

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ─── Decision gates ─────────────────────────────────────────────────────────────
// Runs the vision output through every gate in order. This is the single place
// that decides "is this a searchable plate?" — kept pure so it can be tested
// against the random-image rejection cases without any network call.
export function decidePlateResult(vision: PlateVisionOutput | null | undefined): PlateScanResult {
  // Gate 1 — detection. No plate → reject (person/selfie/building/road/object/document/screenshot).
  if (!vision || vision.isPlate !== true) return rejected('NO_NUMBER_PLATE_DETECTED');

  // Gate 2 — readability. Plate present but characters not legible.
  if (vision.readable !== true || !vision.registration || !vision.registration.trim()) {
    return rejected('PLATE_NOT_READABLE');
  }

  // Gate 3 — OCR text → normalise (uppercase, strip separators, positional fix).
  const normalized = normalizePlate(vision.registration);

  // Gate 4 — South African registration format. Ambiguous / partial → reject.
  if (!validatePlate(normalized)) return rejected('INVALID_REGISTRATION');

  // Gate 5 — confidence floor.
  const confidence = clamp01(vision.confidence);
  if (confidence < CONFIDENCE_THRESHOLD) return rejected('LOW_CONFIDENCE');

  // All gates passed — searchable.
  return { isPlate: true, registration: normalized, confidence, reason: null };
}
