// Manual Part Price Override — pure helper (unit-tested).
//
// parts_cost stores the EFFECTIVE unit price so all downstream estimate/invoice
// logic is untouched:  effective = manualUnitPrice ?? evolveUnitPrice.
//   - evolveUnitPrice is the original Evolve/auto-load price (preserved).
//   - manualUnitPrice is the TrueGear-only override; null means "use Evolve".
//   - isPriceOverridden is true whenever a manual price is present (per spec:
//     set → overridden; cleared/null → not overridden).

export interface ResolvedItemPrice {
  evolveUnitPrice: number;
  manualUnitPrice: number | null;
  effectiveUnitPrice: number;
  isPriceOverridden: boolean;
}

// Round to 2 decimals to avoid floating-point drift.
export const round2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

export function resolveItemPrice(input: {
  partsCost?: number | string | null;      // legacy/effective price when no explicit evolve price is sent
  evolveUnitPrice?: number | string | null;
  manualUnitPrice?: number | string | null;
}): ResolvedItemPrice {
  // Prefer an explicit evolve price; fall back to the incoming parts_cost so
  // existing payloads (no override fields) keep behaving exactly as before.
  const evolveRaw = input.evolveUnitPrice ?? input.partsCost ?? 0;
  const evolveUnitPrice = round2(evolveRaw);

  const hasManual = input.manualUnitPrice !== null && input.manualUnitPrice !== undefined && String(input.manualUnitPrice) !== '';
  const manualUnitPrice = hasManual ? round2(input.manualUnitPrice) : null;

  const effectiveUnitPrice = manualUnitPrice != null ? manualUnitPrice : evolveUnitPrice;
  const isPriceOverridden = manualUnitPrice != null;

  return { evolveUnitPrice, manualUnitPrice, effectiveUnitPrice, isPriceOverridden };
}
