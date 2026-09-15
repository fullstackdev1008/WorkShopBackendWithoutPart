import { FastifyRequest } from 'fastify';
import { or, ilike, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { partsMaster } from '../../db/models';
import { env } from '../../config/env';
import { lookupPartInfo } from '../../services/evolveIrm.service';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// Frontend contract for a part result — must stay { id, partCode, partName, unitPrice }.
interface PartResult {
  id: string;
  partCode: string;
  partName: string;
  unitPrice: number;
}

// Local parts_master search (substring on code OR name). This is the fallback
// used after an Evolve miss/outage, and the sole path when the Evolve flag is off.
async function searchLocalParts(term: string): Promise<PartResult[]> {
  const like = `%${term}%`;
  const rows = await db
    .select({
      id: partsMaster.id,
      partCode: partsMaster.partCode,
      partName: partsMaster.partName,
      unitPrice: partsMaster.defaultPrice,
    })
    .from(partsMaster)
    .where(
      or(
        ilike(partsMaster.partCode, like),
        ilike(partsMaster.partName, like),
      ),
    )
    .limit(20);
  // Cast unitPrice from string (Drizzle numeric) to number.
  return rows.map((r: any) => ({ ...r, unitPrice: Number(r.unitPrice) || 0 }));
}

// ─── Resolve unit prices by part code ─────────────────────────────────────────
// Reuses the same sources as the part search, EVOLVE-FIRST (Evolve is the live,
// authoritative price): Evolve IRM_PartInfoLookup per code (gated by the flag),
// then the local parts_master catalogue (batched, exact code) for any code Evolve
// didn't price. Returns a Map of code → unitPrice for what it could resolve (> 0
// only). Used to price auto-loaded Model-Service-Type parts from Evolve.
export async function resolvePartPrices(codes: string[]): Promise<Map<string, number>> {
  const uniq = Array.from(new Set(codes.map((c) => (c ?? '').trim()).filter(Boolean)));
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;

  // 1) Evolve first — authoritative live price (best-effort, gated by the flag).
  if (env.EVOLVE_PART_SEARCH_ENABLED) {
    await Promise.all(
      uniq.map(async (code) => {
        try {
          const res = await lookupPartInfo(code);
          if (res.outcome === 'FOUND' && Number(res.part.unitPrice) > 0) {
            out.set(code, Number(res.part.unitPrice));
          }
        } catch {
          /* best-effort — fall through to parts_master */
        }
      }),
    );
  }

  // 2) parts_master for any code Evolve didn't price (single batched query).
  const missing = uniq.filter((c) => !out.has(c));
  if (missing.length > 0) {
    const rows = await db
      .select({ code: partsMaster.partCode, price: partsMaster.defaultPrice })
      .from(partsMaster)
      .where(inArray(partsMaster.partCode, missing));
    for (const r of rows as any[]) {
      const p = Number(r.price) || 0;
      if (p > 0) out.set(r.code, p);
    }
  }

  return out;
}

// ─── Search Parts ─────────────────────────────────────────────────────────────
// Flow (when EVOLVE_PART_SEARCH_ENABLED):
//   1. Try Evolve IRM_PartInfoLookup with the entered part number (exact match).
//   2. FOUND       → map to the frontend contract and return (no DB write).
//   3. NOT_FOUND   → fall back to the local parts_master search.
//   4. UNAVAILABLE → fall back to the local parts_master search (never fail).
// When the flag is off, behaviour is exactly as before (local only).
export async function searchParts(request: FastifyRequest) {
  try {
    const { query } = request.query as { query?: string };

    if (!query || !query.trim()) {
      return error(HttpStatus.BAD_REQUEST, 'query parameter is required');
    }

    const q = query.trim();

    // ── Evolve-first (exact part-number lookup), gated by the feature flag ──
    if (env.EVOLVE_PART_SEARCH_ENABLED) {
      console.log(`[parts.search] Evolve lookup started for "${q}"`);
      const result = await lookupPartInfo(q);

      if (result.outcome === 'FOUND') {
        // Evolve has no primary id; the part number is a stable synthetic id
        // (the frontend uses id only as a React key / de-dup handle).
        const data: PartResult[] = [{
          id: result.part.partCode,
          partCode: result.part.partCode,
          partName: result.part.partName,
          unitPrice: result.part.unitPrice,
        }];
        console.log(`[parts.search] Evolve success for "${q}" → ${result.part.partCode} (not persisted)`);
        return success('Parts fetched successfully', data);
      }

      if (result.outcome === 'NOT_FOUND') {
        console.log(`[parts.search] Evolve returned no part for "${q}" — falling back to local`);
      } else {
        console.log(`[parts.search] Evolve unavailable for "${q}" — falling back to local`);
      }
    }

    // ── Local parts_master fallback (also the default when the flag is off) ──
    const data = await searchLocalParts(q);
    console.log(`[parts.search] local search for "${q}" returned ${data.length} row(s)`);
    return success('Parts fetched successfully', data);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
