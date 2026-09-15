import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * EngineNumber: Evolve vehicle search → vehicles.engine_number → RO <EngineNumber>.
 *
 * Why this matters: Evolve refuses to load a labour line under Cost Jobs when the
 * RO's Engine No is blank, so a lost EngineNumber surfaces much later as a manual
 * data-entry blocker rather than as an integration error.
 *
 * The defect these tests lock down: Evolve's vehicle master frequently returns a
 * BLANK EngineNumber (see the real capture in evolveVehicleMap.test.ts). `str()`
 * maps '' / whitespace → null, and the vehicle update previously wrote that null
 * straight over a good local value.
 *
 * No network, no live Evolve call — `db` is mocked and the XML builder is pure.
 */

// ── DB test double ──────────────────────────────────────────────────────────
let existingVehicleRow: Record<string, unknown> | null = null;
const dbUpdates: Array<Record<string, unknown>> = [];
const dbInserts: Array<Record<string, unknown>> = [];

// Honours the projection, so a column the code fails to SELECT is genuinely
// absent from the row — otherwise these tests could pass vacuously.
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
    // The customer upsert runs inside this transaction; these tests only assert
    // on vehicle persistence, so it resolves straight to a customer id.
    transaction: async () => 'cust-1',
    select: (projection?: Record<string, unknown>) => makeSelectChain(projection),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        dbUpdates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        dbInserts.push(values);
        return { returning: () => Promise.resolve([{ id: 'veh-1' }]) };
      },
    }),
  },
}));

import { persistEvolveCustomer, mapEvolveVehicleFields } from '../evolveCustomerPersist.service';
import { buildRoMaintenanceXml } from '../evolveIrm.service';

/** Minimal Evolve lookup result carrying one vehicle. */
function lookupWith(engineNumber: unknown, overrides: Record<string, unknown> = {}) {
  return {
    CustomerDetail: { CustSequenceID: '20EC0002915' },
    CustomerProfile: {},
    AccountsReceivable: {},
    VehiclesAll: [
      {
        VehVinNumber: 'AAK2829FLSB122503',
        RegistrationNo: 'B122503',
        Make: 'FAW',
        Series: 'J5N',
        ModelCode: '18665355',
        EngineNumber: engineNumber,
        ...overrides,
      },
    ],
  } as any;
}

/** The existing local row shape the update path selects for change-detection. */
function localRow(engineNumber: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id: 'veh-1',
    owningCompanyId: null,
    customerId: 'cust-1',
    vin: 'AAK2829FLSB122503',
    brand: 'FAW',
    model: 'J5N',
    manufacturingYear: null,
    engineNumber,
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
  dbInserts.length = 0;
});

// ── Test 1 — Evolve search returns EngineNumber → persisted ─────────────────
describe('Test 1 — Evolve search returns an EngineNumber', () => {
  it('persists it to vehicles.engine_number on a NEW vehicle', async () => {
    await persistEvolveCustomer(lookupWith('ENG123456'));

    expect(dbInserts).toHaveLength(1);
    expect(dbInserts[0].engineNumber).toBe('ENG123456');
  });

  it('persists it on an EXISTING vehicle that has none yet (backfill)', async () => {
    existingVehicleRow = localRow(null);
    await persistEvolveCustomer(lookupWith('ENG123456'));

    expect(dbUpdates).toHaveLength(1);
    expect(dbUpdates[0].engineNumber).toBe('ENG123456');
  });

  it('maps EngineNumber → engineNumber in the field mapper', () => {
    expect(mapEvolveVehicleFields({ EngineNumber: 'ENG123456' }).engineNumber).toBe('ENG123456');
  });
});

// ── Test 2 — whitespace is trimmed ──────────────────────────────────────────
describe('Test 2 — whitespace trimming', () => {
  it('trims surrounding whitespace before persisting', async () => {
    await persistEvolveCustomer(lookupWith('  ENG123456  '));

    expect(dbInserts[0].engineNumber).toBe('ENG123456');
  });

  it('trims in the field mapper too', () => {
    expect(mapEvolveVehicleFields({ EngineNumber: '  ENG123456  ' }).engineNumber).toBe('ENG123456');
  });
});

// ── Test 3 — an empty Evolve response must NOT erase a good local value ─────
describe('Test 3 — blank Evolve EngineNumber does not destroy a valid local value', () => {
  // The exact regression: each of these previously became `null` in the UPDATE.
  for (const [label, blank] of [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ] as const) {
    it(`preserves the local value when Evolve returns ${label}`, async () => {
      // Another field differs, so change-detection fires a real UPDATE — this is
      // the case where the destructive overwrite used to happen.
      existingVehicleRow = localRow('ENG123456', { brand: 'STALE' });

      await persistEvolveCustomer(lookupWith(blank));

      expect(dbUpdates).toHaveLength(1);
      expect(dbUpdates[0].engineNumber).toBe('ENG123456');
      expect(dbUpdates[0].engineNumber).not.toBeNull();
      // The unrelated field still updates — the guard is scoped to engineNumber.
      expect(dbUpdates[0].brand).toBe('FAW');
    });
  }

  it('preserves the value even when nothing else changed', async () => {
    existingVehicleRow = localRow('ENG123456');

    await persistEvolveCustomer(lookupWith(''));

    // With the guard restoring the local value, nothing differs at all, so
    // change-detection correctly suppresses the write entirely. (Before the
    // separate VIN change-detection fix this still wrote, because `vin` was
    // absent from the SELECT and always compared unequal.) Either way the
    // value survives — here it survives by not being written at all.
    expect(dbUpdates).toHaveLength(0);
  });

  it('still lets a NON-empty Evolve value overwrite a stale local one', async () => {
    // Guard must not freeze the field — genuine Evolve updates still win.
    existingVehicleRow = localRow('OLD-ENGINE');

    await persistEvolveCustomer(lookupWith('NEW-ENGINE'));

    expect(dbUpdates).toHaveLength(1);
    expect(dbUpdates[0].engineNumber).toBe('NEW-ENGINE');
  });
});

// ── Test 4 — RO sync sends the persisted value ──────────────────────────────
describe('Test 4 — RO request carries the persisted EngineNumber', () => {
  const baseRo = {
    crmReferenceNo: 'crm-1',
    ownerCustSequenceId: '20EC0002915',
    vin: 'AAK2829FLSB122503',
    make: 'FAW',
    modelCode: '18665355',
  };

  it('emits <EngineNumber>ENG123456</EngineNumber>', () => {
    const xml = buildRoMaintenanceXml({ ...baseRo, engineNumber: 'ENG123456' });

    expect(xml).toContain('<EngineNumber>ENG123456</EngineNumber>');
  });

  it('escapes XML-special characters consistently with the rest of the builder', () => {
    const xml = buildRoMaintenanceXml({ ...baseRo, engineNumber: 'ENG&123<456' });

    expect(xml).toContain('<EngineNumber>ENG&amp;123&lt;456</EngineNumber>');
    expect(xml).not.toContain('ENG&123<456');
  });
});

// ── Test 5 — no EngineNumber: existing behaviour preserved ──────────────────
describe('Test 5 — no EngineNumber available', () => {
  const baseRo = {
    crmReferenceNo: 'crm-1',
    ownerCustSequenceId: '20EC0002915',
    vin: 'AAK2829FLSB122503',
    make: 'FAW',
    modelCode: '18665355',
  };

  it('OMITS the element entirely — no blank tag, no fabricated or default value', () => {
    // NULL, undefined, '' and whitespace-only are ONE state: absent.
    for (const missing of [undefined, '', '   ', '\t\n ']) {
      const xml = buildRoMaintenanceXml({ ...baseRo, engineNumber: missing });

      // The element is OMITTED entirely rather than sent empty. An empty
      // <EngineNumber> on an UPDATE can overwrite a value Evolve already holds,
      // and Evolve then refuses to load a labour line under Cost Jobs.
      expect(xml).not.toContain('<EngineNumber>');
      // Nothing invented to fill the gap either.
      expect(xml).not.toMatch(/<EngineNumber>\s*(N\/A|UNKNOWN|NONE|0)\s*<\/EngineNumber>/i);
    }
  });

  it('leaves engine_number null when Evolve has none and we have none', async () => {
    await persistEvolveCustomer(lookupWith(null));

    expect(dbInserts).toHaveLength(1);
    expect(dbInserts[0].engineNumber).toBeNull();
  });
});
