import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Vehicle change-detection: `vin` must be SELECTed so the diff is meaningful.
 *
 * The bug: persistEvolveCustomer writes `vin` as part of updateValues, so it is
 * one of the fields compared by the change-detection diff. But `vin` was NOT in
 * the SELECT that loads the existing row, so existingRow.vin was always
 * `undefined`. The comparison therefore reduced to:
 *
 *     norm('<incoming vin>') !== norm(undefined)   // 'AAK…' !== null → ALWAYS true
 *
 * so `changed` was always true and the optimisation never suppressed anything:
 * every Evolve re-sync wrote and bumped updated_at, which is exactly what the
 * optimisation existed to prevent (released vehicles resurfacing in
 * date-filtered lists).
 *
 * These tests are about the DIFF only. EngineNumber behaviour is covered
 * separately in evolveEngineNumber.test.ts and is not re-litigated here.
 *
 * No network, no live Evolve call — `db` is mocked.
 */

// ── DB test double ──────────────────────────────────────────────────────────
let existingVehicleRow: Record<string, unknown> | null = null;
const dbUpdates: Array<Record<string, unknown>> = [];

/**
 * The select double HONOURS THE PROJECTION: it returns only the columns the
 * code actually asked for, exactly as the database would. This is essential —
 * a double that returns the whole row regardless would still supply `vin` even
 * when the SELECT omits it, and every test here would pass vacuously against
 * the unfixed code.
 */
function makeSelectChain(projection?: Record<string, unknown>) {
  const result = () => {
    if (!existingVehicleRow) return [];
    if (!projection) return [existingVehicleRow];
    const row: Record<string, unknown> = {};
    for (const key of Object.keys(projection)) row[key] = existingVehicleRow[key];
    return [row];
  };
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(result()),
    then: (res: any) => Promise.resolve(result()).then(res),
  };
  return chain;
}

vi.mock('../../db', () => ({
  db: {
    transaction: async () => 'cust-1',
    select: (projection?: Record<string, unknown>) => makeSelectChain(projection),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        dbUpdates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 'veh-1' }]) }),
    }),
  },
}));

import { persistEvolveCustomer } from '../evolveCustomerPersist.service';

const VIN = 'AAK2829FLSB122503';

function lookupWith(vin: unknown) {
  return {
    CustomerDetail: { CustSequenceID: '20EC0002915' },
    CustomerProfile: {},
    AccountsReceivable: {},
    VehiclesAll: [
      {
        VehVinNumber: vin,
        RegistrationNo: 'B122503',
        Make: 'FAW',
        Series: 'J5N',
        ModelCode: '18665355',
        EngineNumber: 'ENG123456',
      },
    ],
  } as any;
}

/**
 * Mirrors the real change-detection SELECT exactly — including `vin`, which is
 * the field this fix adds. Every value matches what the Evolve payload above
 * maps to, so by default NOTHING differs.
 */
function localRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'veh-1',
    owningCompanyId: null,
    customerId: 'cust-1',
    vin: VIN,
    brand: 'FAW',
    model: 'J5N',
    manufacturingYear: null,
    engineNumber: 'ENG123456',
    extColour: null,
    seriesDescription: 'J5N',
    modelDescription: null,
    modelCode: '18665355',
    registrationDate: null,
    registrationYear: null,
    evolveSellingDate: null,
    sellingDealerCode: null,
    registrationNumber: 'B122503',
    ...overrides,
  };
}

beforeEach(() => {
  existingVehicleRow = null;
  dbUpdates.length = 0;
});

describe('VIN is included in change-detection', () => {
  // ── The regression itself ─────────────────────────────────────────────────
  it('does NOT report a change when the existing VIN equals the incoming VIN', async () => {
    existingVehicleRow = localRow();

    await persistEvolveCustomer(lookupWith(VIN));

    // Before the fix this wrote unconditionally, purely because `vin` was
    // missing from the SELECT. Nothing actually differs, so nothing is written.
    expect(dbUpdates).toHaveLength(0);
  });

  it('detects a change when the existing VIN differs from the incoming VIN', async () => {
    existingVehicleRow = localRow({ vin: 'DIFFERENT-VIN-000000' });

    await persistEvolveCustomer(lookupWith(VIN));

    expect(dbUpdates).toHaveLength(1);
    expect(dbUpdates[0].vin).toBe(VIN);
  });

  it('detects a change when the existing VIN is NULL and the incoming VIN is populated', async () => {
    existingVehicleRow = localRow({ vin: null });

    await persistEvolveCustomer(lookupWith(VIN));

    expect(dbUpdates).toHaveLength(1);
    expect(dbUpdates[0].vin).toBe(VIN);
  });

  // ── Blank incoming VIN: intended behaviour is to skip the vehicle ─────────
  for (const [label, blank] of [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ] as const) {
    it(`skips the vehicle entirely when the incoming VIN is ${label} (unchanged behaviour)`, async () => {
      existingVehicleRow = localRow();

      await persistEvolveCustomer(lookupWith(blank));

      // `const vin = str(veh.VehVinNumber); if (!vin) continue;` runs BEFORE the
      // lookup, so a blank incoming VIN never reaches change-detection and can
      // never blank out a stored VIN. This fix does not alter that.
      expect(dbUpdates).toHaveLength(0);
    });
  }

  // ── The optimisation still lets real changes through ─────────────────────
  it('still detects changes in other fields when the VIN matches', async () => {
    existingVehicleRow = localRow({ brand: 'STALE-BRAND' });

    await persistEvolveCustomer(lookupWith(VIN));

    expect(dbUpdates).toHaveLength(1);
    expect(dbUpdates[0].brand).toBe('FAW');
  });

  it('normalisation is unchanged — null and undefined still compare equal', async () => {
    // manufacturingYear is null locally and absent from the Evolve payload.
    // norm() maps both to null, so this must NOT count as a change.
    existingVehicleRow = localRow({ manufacturingYear: null });

    await persistEvolveCustomer(lookupWith(VIN));

    expect(dbUpdates).toHaveLength(0);
  });
});
