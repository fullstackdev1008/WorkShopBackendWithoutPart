/**
 * Eagerly resolve + persist a vehicle's Evolve ModelCode at create/update time
 * so it is reviewable before any RO sync and amortizes resolution.
 *
 * Fill-blanks-only (H2): NEVER overwrites a non-blank model_code (a manual /
 * picker / Evolve-imported value is authoritative) and NEVER writes a
 * non-HIGH / guessed code (no first-code fallback). Mode-gated so LOG stays
 * inert. Fire-and-forget; never throws.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { vehicles } from '../db/models';
import { env } from '../config/env';
import { resolveModelCode } from './modelCodeResolver.service';

export async function resolveAndPersistModelCode(vehicleId: string): Promise<void> {
  try {
    const mode = env.EVOLVE_MODELCODE_MODE;
    if (mode === 'OFF') return; // fully inert

    const [v] = await db
      .select({
        id: vehicles.id,
        brand: vehicles.brand,
        model: vehicles.model,
        modelCode: vehicles.modelCode,
      })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.deletedAt)))
      .limit(1);
    if (!v) return;

    // Fill-blanks-only: never touch a value a human / Evolve already set.
    if ((v.modelCode ?? '').trim()) return;

    const r = await resolveModelCode(v.brand, v.model); // catalog read-only

    if (mode === 'LOG') {
      console.log(`[VehicleModelCode] LOG vehicle ${vehicleId} make/model="${v.brand}/${v.model}" resolver=${r.confidence} code=${r.code ?? ''}`);
      return; // LOG = zero writes
    }

    // WARN / ENFORCE — persist HIGH-confidence only.
    if (r.confidence === 'HIGH' && r.code) {
      await db.update(vehicles)
        .set({ modelCode: r.code, updatedAt: new Date() })
        .where(eq(vehicles.id, vehicleId));
      console.log(`[VehicleModelCode] vehicle ${vehicleId} model_code=${r.code} (HIGH)`);
    } else {
      console.log(`[VehicleModelCode] vehicle ${vehicleId} unresolved (${r.confidence}) — left blank for review`);
    }
  } catch (err) {
    console.error(`[VehicleModelCode] resolve/persist failed for ${vehicleId}:`, (err as Error)?.message);
  }
}
