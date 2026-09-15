/**
 * Out-of-band catalog warm job: populate vehicle_models (Series) and
 * vehicle_model_codes (Make→Series→ModelCode) from Evolve so the read-only
 * resolver has data to match against.
 *
 * This is the ONLY place (besides the user-driven picker) that calls Evolve for
 * model codes and writes the catalog — it is NEVER invoked from the RO sync
 * path. Per-make TTL dedup prevents fetch storms. Never throws.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { vehicleMakes, vehicleModels, vehicleModelCodes } from '../db/models';
import { env } from '../config/env';
import { fetchSeriesForMake, fetchModelCodesForSeries } from './masterDataSync.service';

const lastWarmedByMake = new Map<string, number>();

export interface WarmSummary { make: string; series: number; codes: number; skipped?: boolean }

/** Warm the catalog for one make (by display name or Evolve code). Read+write catalog only. */
export async function warmCatalogForMake(makeNameOrCode: string, opts: { force?: boolean } = {}): Promise<WarmSummary> {
  const summary: WarmSummary = { make: makeNameOrCode, series: 0, codes: 0 };
  try {
    const key = (makeNameOrCode ?? '').trim().toUpperCase();
    if (!key) return summary;

    const last = lastWarmedByMake.get(key);
    if (!opts.force && last && Date.now() - last < env.EVOLVE_CATALOG_WARM_TTL_MS) {
      return { ...summary, skipped: true };
    }

    const makes = await db
      .select({ id: vehicleMakes.id, name: vehicleMakes.name, code: vehicleMakes.code })
      .from(vehicleMakes);
    const make = makes.find(
      (m) => (m.name ?? '').toUpperCase() === key || (m.code ?? '').toUpperCase() === key,
    );
    if (!make) {
      console.warn(`[CatalogWarm] make "${makeNameOrCode}" not in vehicle_makes — run master-data sync first`);
      return summary;
    }

    const makeParam = make.code || make.name;

    // 1) Series → vehicle_models.
    const series = await fetchSeriesForMake(makeParam);
    if (series.length) {
      await db
        .insert(vehicleModels)
        .values(series.map((s) => ({ makeId: make.id, name: s.name })))
        .onConflictDoUpdate({ target: [vehicleModels.makeId, vehicleModels.name], set: { updatedAt: new Date() } });
      summary.series = series.length;
    }

    // 2) Model codes per series → vehicle_model_codes.
    const models = await db
      .select({ id: vehicleModels.id, name: vehicleModels.name })
      .from(vehicleModels)
      .where(eq(vehicleModels.makeId, make.id));

    for (const m of models) {
      const codes = await fetchModelCodesForSeries(makeParam, m.name);
      if (!codes.length) continue;
      await db
        .insert(vehicleModelCodes)
        .values(codes.map((c) => ({ modelId: m.id, code: c.code, mandmCode: c.mandmCode, description: c.description, modelYear: c.year })))
        .onConflictDoUpdate({
          target: [vehicleModelCodes.modelId, vehicleModelCodes.code, vehicleModelCodes.modelYear],
          set: { mandmCode: sql`excluded.mandm_code`, description: sql`excluded.description`, updatedAt: new Date() },
        });
      summary.codes += codes.length;
    }

    lastWarmedByMake.set(key, Date.now());
    console.log(`[CatalogWarm] make ${make.name}: ${summary.series} series, ${summary.codes} codes`);
    return summary;
  } catch (err) {
    console.error(`[CatalogWarm] warm failed for "${makeNameOrCode}":`, (err as Error)?.message);
    return summary;
  }
}

/**
 * Cron entry: warm only the makes that need it — distinct brands of vehicles
 * whose model_code is still blank. Bounded + per-make TTL throttled. Dormant
 * unless EVOLVE_CATALOG_WARM_ENABLED. Never throws.
 */
export async function warmCatalogForUnresolvedMakes(limit = 50): Promise<{ makesWarmed: number }> {
  try {
    if (!env.EVOLVE_CATALOG_WARM_ENABLED) return { makesWarmed: 0 };

    const result = (await db.execute(sql`
      SELECT DISTINCT brand FROM vehicles
      WHERE deleted_at IS NULL
        AND (model_code IS NULL OR btrim(model_code) = '')
        AND brand IS NOT NULL AND btrim(brand) <> ''
      LIMIT ${limit}
    `)) as unknown as { rows?: Array<{ brand: string }> };
    const brands = result?.rows ?? [];

    let warmed = 0;
    for (const b of brands) {
      const r = await warmCatalogForMake(b.brand);
      if (!r.skipped) warmed++;
    }
    if (brands.length) console.log(`[CatalogWarm] swept ${brands.length} make(s) with unresolved vehicles`);
    return { makesWarmed: warmed };
  } catch (err) {
    console.error('[CatalogWarm] sweep failed:', (err as Error)?.message);
    return { makesWarmed: 0 };
  }
}
