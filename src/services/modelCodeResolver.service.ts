/**
 * ModelCode resolver — the single owner of "given a make + model, what is the
 * Evolve ModelCode?".
 *
 * HARD CONTRACT (do not weaken):
 *   - READ-ONLY against the local catalog (vehicle_makes → vehicle_models →
 *     vehicle_model_codes). It NEVER calls Evolve and NEVER writes. Catalog
 *     population is a separate out-of-band concern (modelCodeCatalogWarm +
 *     the vehicles picker).
 *   - NO first-code fallback. Anything below HIGH confidence returns no usable
 *     code; the caller decides (defer / manual).
 *   - Fail-closed: empty catalog / no signal → UNRESOLVED (never a guess).
 *
 * The matching logic lives in the pure, db-free modelCodeMatcher module.
 */
import { or, ilike, eq } from 'drizzle-orm';
import { db } from '../db';
import { vehicleMakes, vehicleModels, vehicleModelCodes } from '../db/models';
import { matchModelCode, normalise, ModelCodeRow, MatchResult } from './modelCodeMatcher';

// Re-export the matcher's types + helpers so existing consumers keep importing
// them from the resolver service.
export { matchModelCode, normalise } from './modelCodeMatcher';
export type { ModelCodeConfidence, ModelCodeRow, MatchResult } from './modelCodeMatcher';
export type ResolveResult = MatchResult;

// ─── Read-only catalog lookup ────────────────────────────────────────────────

// Short-lived negative/positive memo to avoid re-querying the catalog on every
// reconcile tick. TTL is short so a freshly-warmed catalog is picked up soon.
const RESOLVE_MEMO_TTL_MS = 10 * 60 * 1000;
const resolveMemo = new Map<string, { at: number; result: MatchResult }>();

/** Load the catalog rows for a make (by Evolve code OR display name). Read-only. */
async function loadCatalogRows(make: string): Promise<ModelCodeRow[]> {
  const rows = await db
    .select({
      code: vehicleModelCodes.code,
      description: vehicleModelCodes.description,
      modelYear: vehicleModelCodes.modelYear,
    })
    .from(vehicleModelCodes)
    .innerJoin(vehicleModels, eq(vehicleModels.id, vehicleModelCodes.modelId))
    .innerJoin(vehicleMakes, eq(vehicleMakes.id, vehicleModels.makeId))
    .where(or(ilike(vehicleMakes.name, make), ilike(vehicleMakes.code, make)));
  return rows as ModelCodeRow[];
}

/**
 * Resolve a ModelCode for (make, model) from the LOCAL catalog only.
 * Returns UNRESOLVED when the make has no catalog rows — it does NOT trigger an
 * Evolve fetch (population is the warm job's job). A usable `code` is present
 * only for HIGH/MEDIUM; callers must treat anything below HIGH as not-sendable.
 */
export async function resolveModelCode(
  make: string,
  model: string,
  opts: { useMemo?: boolean } = {},
): Promise<ResolveResult> {
  const useMemo = opts.useMemo !== false;
  const mk = (make ?? '').trim();
  const md = (model ?? '').trim();
  if (!mk || !md) return { code: null, confidence: 'UNRESOLVED' };

  const key = `${normalise(mk)}|${normalise(md)}`;
  if (useMemo) {
    const hit = resolveMemo.get(key);
    if (hit && Date.now() - hit.at < RESOLVE_MEMO_TTL_MS) return hit.result;
  }

  let result: MatchResult;
  try {
    const rows = await loadCatalogRows(mk);
    result = matchModelCode(md, rows);
  } catch (err) {
    // Never throw to the sync path; a DB hiccup is a transient UNRESOLVED.
    console.error(`[ModelCodeResolver] catalog read failed for make="${mk}":`, (err as Error)?.message);
    return { code: null, confidence: 'UNRESOLVED' };
  }

  if (useMemo) resolveMemo.set(key, { at: Date.now(), result });
  return result;
}
