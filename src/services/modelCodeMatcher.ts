/**
 * Pure ModelCode matcher — no I/O, no db, no env. Unit-testable in isolation.
 *
 * Rules (corrected design):
 *   - HIGH only when exactly ONE distinct code matches the normalized description
 *     exactly. NO first-code fallback. NO year-based auto-disambiguation
 *     (registration_year ≠ model_year): exact match to >1 distinct code is
 *     AMBIGUOUS, never an automatic pick.
 *   - A usable `code` is returned for HIGH and MEDIUM only; null otherwise.
 */

export type ModelCodeConfidence =
  | 'HIGH'        // exactly one distinct code via exact normalized description match
  | 'MEDIUM'      // single dominant fuzzy candidate above threshold (suggestion only)
  | 'LOW'         // weak signal; manual review
  | 'AMBIGUOUS'   // exact/strong match maps to >1 distinct code; manual review
  | 'UNRESOLVED'; // no candidates / no signal

export interface ModelCodeRow {
  code: string;
  description: string | null;
  modelYear: number | null;
}

export interface MatchResult {
  code: string | null;
  confidence: ModelCodeConfidence;
  candidates?: string[];
}

/** Uppercase, strip everything but A-Z0-9 (matches the historical normModelDesc). */
export function normalise(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Alphanumeric tokens (split on any non-alphanumeric), uppercased, deduped. */
function tokens(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? '')
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const FUZZY_THRESHOLD = 0.6;

/** Classify a local model string against the catalog rows for its make. */
export function matchModelCode(model: string, candidates: ModelCodeRow[]): MatchResult {
  const target = normalise(model);
  if (!target || candidates.length === 0) {
    return { code: null, confidence: 'UNRESOLVED' };
  }

  // Collapse to distinct codes, keeping every description seen for that code.
  const byCode = new Map<string, string[]>();
  for (const row of candidates) {
    const code = (row.code ?? '').trim();
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(row.description ?? '');
    byCode.set(code, list);
  }
  if (byCode.size === 0) return { code: null, confidence: 'UNRESOLVED' };

  // 1) EXACT normalized match.
  const exactCodes: string[] = [];
  for (const [code, descs] of byCode) {
    if (descs.some((d) => normalise(d) === target)) exactCodes.push(code);
  }
  if (exactCodes.length === 1) return { code: exactCodes[0], confidence: 'HIGH' };
  if (exactCodes.length > 1) return { code: null, confidence: 'AMBIGUOUS', candidates: exactCodes };

  // 2) Fuzzy: containment + token overlap, scored per distinct code.
  const targetTokens = tokens(model);
  const scored: Array<{ code: string; score: number }> = [];
  for (const [code, descs] of byCode) {
    let best = 0;
    for (const d of descs) {
      const nd = normalise(d);
      let s = jaccard(targetTokens, tokens(d));
      if (nd && (nd.includes(target) || target.includes(nd))) {
        const ratio = Math.min(nd.length, target.length) / Math.max(nd.length, target.length);
        s = Math.max(s, ratio);
      }
      if (s > best) best = s;
    }
    if (best > 0) scored.push({ code, score: best });
  }
  if (scored.length === 0) return { code: null, confidence: 'UNRESOLVED' };

  scored.sort((a, b) => b.score - a.score);
  const above = scored.filter((s) => s.score >= FUZZY_THRESHOLD);
  if (above.length === 1) {
    return { code: above[0].code, confidence: 'MEDIUM', candidates: [above[0].code] };
  }
  if (above.length > 1) {
    return { code: null, confidence: 'AMBIGUOUS', candidates: above.map((s) => s.code) };
  }
  return { code: null, confidence: 'LOW', candidates: scored.slice(0, 5).map((s) => s.code) };
}
