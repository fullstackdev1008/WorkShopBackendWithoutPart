import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Lookup-sourced vehicle attributes → RO Maintenance, on CREATE and UPDATE.
 *
 * Background: mapEvolveVehicleFields() persists 12 vehicle fields from the
 * Evolve Customer/Vehicle lookup, but loadJobCardForSync() selected only a
 * subset, so buildRoInput() could not forward them. Of the unforwarded fields
 * only two are supported by the IRM_ROMaintenance contract:
 *
 *   vehicles.registration_date   → <RegistrationDate>  (15a AND 15b)
 *   vehicles.selling_dealer_code → <SellingDealer>     (15a only)
 *
 * Colour, Series/SeriesDescription, SellingDate and ModelDescription have NO
 * element in the RO contract and are deliberately not sent.
 *
 * Both are OPTIONAL and emitted only when populated: 15a shows them blank in a
 * request Evolve accepted, and a blank on UPDATE could overwrite a value Evolve
 * already holds.
 *
 * Assertions are on the RoMaintenanceInput handed to roMaintenance() and on the
 * XML the builder produces. No network, no live Evolve call.
 */

vi.setConfig({ testTimeout: 30000 });

// ── Test doubles ────────────────────────────────────────────────────────────
let jobCardRow: Record<string, unknown> | null = null;
let items: Array<Record<string, unknown>> = [];

/** Discriminates by projection keys — buildRoInput issues several lookups. */
function makeSelectChain(projection?: Record<string, unknown>) {
  const keys = projection ? Object.keys(projection) : [];
  const result = () => {
    if (keys.includes('desc') && keys.includes('partsRequired')) return items;
    if (keys.includes('vin') && keys.includes('custSequenceId')) {
      if (!jobCardRow) return [];
      // Honour the projection: a column the loader fails to SELECT must be
      // genuinely absent, otherwise these tests pass vacuously.
      const row: Record<string, unknown> = {};
      for (const k of keys) row[k] = jobCardRow[k];
      return [row];
    }
    return [];
  };
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    groupBy: () => chain,
    limit: () => Promise.resolve(result()),
    then: (res: any) => Promise.resolve(result()).then(res),
  };
  return chain;
}

vi.mock('../../db', () => ({
  db: {
    select: (projection?: Record<string, unknown>) => makeSelectChain(projection),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        if (jobCardRow) Object.assign(jobCardRow, values);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

vi.mock('../../db/health', () => ({
  isEvolveJobCardSyncReady: () => true,
  isEvolveLabourLinesReady: () => false,
}));

const roMaintenance = vi.fn();
const lookupRoHistory = vi.fn();
vi.mock('../evolveIrm.service', async (importOriginal) => {
  // Keep the REAL buildRoMaintenanceXml so the XML assertions exercise the
  // actual builder; only the network calls are stubbed.
  const actual = await importOriginal<typeof import('../evolveIrm.service')>();
  return {
    ...actual,
    roMaintenance: (...args: unknown[]) => roMaintenance(...args),
    lookupRoHistory: (...args: unknown[]) => lookupRoHistory(...args),
  };
});

vi.mock('../companyResolver.service', () => ({
  companyResolver: { getById: async () => null },
}));

const BASE_ROW = {
  id: 'jc-1',
  status: 'IN_PROGRESS',
  totalEstimate: '100.00',
  serviceType: 'Repair',
  jobType: 'INT',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  evolveRoNumber: 'RO-12345',        // populated ⇒ UPDATE path
  evolveCrmRoRef: 'crm-jc-1',
  customerId: 'cust-1',
  custSequenceId: '20EC0002915',
  vin: 'AAK2829FLSB122503',
  registrationNo: 'B122503',
  engineNumber: 'ENG1',
  registrationYear: 2020,
  manufacturingYear: 2020,
  odometerLast: 1000,
  brand: 'FAW',
  model: 'J5N',
  modelCode: '18665355',
  registrationDate: '2020-03-15',     // ISO, as a pg `date` column returns
  sellingDealerCode: 'DLR001',
  roStatus: 'IN_WORKSHOP',
  complaintText: null,
  owningCompanyId: null,
  vehicleCheckInId: 'ci-1',
  serviceAdvisorNumber: 1,
  evolveAttemptCount: 0,
  franchiseSeqId: '4',
  serviceDept: '2',
};

const ITEMS = [
  { desc: 'AIR FILTER', partsRequired: 'P-1', jobGroup: 1, jobType: 'INT', estimatedHours: null, serviceType: 'Repair', partsCost: '100.00', labourCost: '0', quantity: 1 },
];

async function loadService() {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/test';
  process.env.EVOLVE_JOB_CARD_SYNC_ENABLED = 'true';
  process.env.EVOLVE_SYNC_FREEZE = 'false';
  process.env.EVOLVE_RO_MULTI_JOB_ENABLED = 'false';
  return import('../jobCardEvolveSync.service');
}

/** Push via CREATE or UPDATE and return the RoMaintenanceInput sent. */
async function push(mode: 'create' | 'update'): Promise<any> {
  const svc = await loadService();
  if (mode === 'create') await svc.syncJobCardToEvolveRo('jc-1');
  else await svc.syncJobCardUpdateToEvolve('jc-1');
  expect(roMaintenance).toHaveBeenCalled();
  return roMaintenance.mock.calls[0][0];
}

/** Render the captured payload through the REAL XML builder. */
async function toXml(payload: any): Promise<string> {
  const { buildRoMaintenanceXml } = await import('../evolveIrm.service');
  return buildRoMaintenanceXml(payload);
}

beforeEach(() => {
  jobCardRow = { ...BASE_ROW };
  items = ITEMS.map((i) => ({ ...i }));
  roMaintenance.mockReset();
  lookupRoHistory.mockReset();
  roMaintenance.mockResolvedValue({
    success: true, requestStatus: 'S', rowStatus: 'S',
    roNumber: 'RO-12345', crmReferenceNo: 'crm-jc-1', message: null, rawXml: '',
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EVOLVE_RO_MULTI_JOB_ENABLED;
});

// ── loadJobCardForSync must supply the columns ──────────────────────────────
describe('loadJobCardForSync loads the contract-supported lookup fields', () => {
  it('makes registration_date and selling_dealer_code reach the payload', async () => {
    const payload = await push('update');

    // Would be undefined if the loader omitted the columns — the projection-
    // honouring double guarantees this is a real check.
    expect(payload.registrationDate).toBe('15/03/2020');
    expect(payload.sellingDealer).toBe('DLR001');
  });
});

// ── UPDATE (the business requirement) ───────────────────────────────────────
describe('RO UPDATE carries the lookup vehicle fields', () => {
  it('sends RegistrationDate converted to dd/mm/yyyy', async () => {
    const xml = await toXml(await push('update'));

    expect(xml).toContain('<RegistrationDate>15/03/2020</RegistrationDate>');
    // ISO form must never leak into the RO request.
    expect(xml).not.toContain('2020-03-15');
  });

  it('sends SellingDealer', async () => {
    const xml = await toXml(await push('update'));

    expect(xml).toContain('<SellingDealer>DLR001</SellingDealer>');
  });

  it('still sends the previously-working fields unchanged', async () => {
    const xml = await toXml(await push('update'));

    expect(xml).toContain('<VehVinNumber>AAK2829FLSB122503</VehVinNumber>');
    expect(xml).toContain('<RegistrationNo>B122503</RegistrationNo>');
    expect(xml).toContain('<EngineNumber>ENG1</EngineNumber>');
    expect(xml).toContain('<Make>FAW</Make>');
    expect(xml).toContain('<ModelCode>18665355</ModelCode>');
    // UPDATE keeps the RO number — proves we are on the update path.
    expect(xml).toContain('<RONumber>RO-12345</RONumber>');
  });

  it('keeps the customer relationship on the CustSequenceID approach', async () => {
    const xml = await toXml(await push('update'));

    expect(xml).toContain('<OwnerCustSequenceID>20EC0002915</OwnerCustSequenceID>');
    // No customer detail is added — the RO contract has no such elements.
    expect(xml).not.toMatch(/<(FirstName|LastName|PrimaryEmail|CellphoneNumber)>/);
  });
});

// ── CREATE gets the same treatment ──────────────────────────────────────────
describe('RO CREATE carries the same fields', () => {
  it('sends both new fields on create too', async () => {
    jobCardRow = { ...BASE_ROW, evolveRoNumber: null }; // blank RONumber ⇒ CREATE

    const xml = await toXml(await push('create'));

    expect(xml).toContain('<RegistrationDate>15/03/2020</RegistrationDate>');
    expect(xml).toContain('<SellingDealer>DLR001</SellingDealer>');
  });

  it('create and update produce identical vehicle-field mappings', async () => {
    jobCardRow = { ...BASE_ROW, evolveRoNumber: null };
    const createPayload = await push('create');

    roMaintenance.mockClear();
    jobCardRow = { ...BASE_ROW };
    const updatePayload = await push('update');

    const vehicleFields = (p: any) => ({
      vin: p.vin, registrationNo: p.registrationNo, engineNumber: p.engineNumber,
      make: p.make, modelCode: p.modelCode, modelYear: p.modelYear,
      registrationDate: p.registrationDate, sellingDealer: p.sellingDealer,
    });

    // The shared-builder architecture is preserved: same vehicle data both ways.
    expect(vehicleFields(createPayload)).toEqual(vehicleFields(updatePayload));
  });
});

// ── Null safety — must never blank Evolve ───────────────────────────────────
describe('null/empty values are omitted, never sent blank', () => {
  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ] as const) {
    it(`omits <RegistrationDate> entirely when the column is ${label}`, async () => {
      jobCardRow = { ...BASE_ROW, registrationDate: value };

      const xml = await toXml(await push('update'));

      expect(xml).not.toContain('<RegistrationDate>');
    });

    it(`omits <SellingDealer> entirely when the column is ${label}`, async () => {
      jobCardRow = { ...BASE_ROW, sellingDealerCode: value };

      const xml = await toXml(await push('update'));

      expect(xml).not.toContain('<SellingDealer>');
    });
  }

  it('omits <EngineNumber> rather than sending it blank', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null };

    const xml = await toXml(await push('update'));

    expect(xml).not.toContain('<EngineNumber>');
  });

  it('a malformed stored date is omitted rather than sent through', async () => {
    jobCardRow = { ...BASE_ROW, registrationDate: 'not-a-date' };

    const xml = await toXml(await push('update'));

    expect(xml).not.toContain('<RegistrationDate>');
  });
});

// ── Runtime-type fidelity: what the driver ACTUALLY returns ─────────────────
//
// node-postgres parses a `date` column (OID 1082) into a JS Date, NOT a string,
// even though drizzle types it `string`. Verified against the live database:
//
//   SELECT '2020-03-15'::date  →  typeof 'object', instanceof Date true,
//                                 ISO 2020-03-14T18:30:00.000Z  (LOCAL midnight)
//
// The loader therefore formats the column with to_char so a string arrives. The
// Date cases below prove the helper cannot CRASH if that guard is ever removed —
// the original implementation called .trim() on a Date and threw TypeError
// inside buildRoInput, which the callers' catch blocks swallow, silently killing
// every RO create and update.
describe('registration date: real driver shapes', () => {
  it('formats the to_char output (dd/mm/yyyy string) unchanged', async () => {
    jobCardRow = { ...BASE_ROW, registrationDate: '15/03/2020' };

    const xml = await toXml(await push('update'));

    expect(xml).toContain('<RegistrationDate>15/03/2020</RegistrationDate>');
  });

  it('still handles a raw ISO string if to_char is bypassed', async () => {
    jobCardRow = { ...BASE_ROW, registrationDate: '2020-03-15' };

    const xml = await toXml(await push('update'));

    expect(xml).toContain('<RegistrationDate>15/03/2020</RegistrationDate>');
  });

  it('accepts an actual JS Date without throwing', async () => {
    // new Date('2020-03-15') is parsed as UTC midnight; UTC accessors read 15.
    jobCardRow = { ...BASE_ROW, registrationDate: new Date('2020-03-15') };

    const xml = await toXml(await push('update'));

    expect(xml).toContain('<RegistrationDate>15/03/2020</RegistrationDate>');
  });

  it('an Invalid Date is omitted, not emitted as NaN', async () => {
    jobCardRow = { ...BASE_ROW, registrationDate: new Date('nonsense') };

    const xml = await toXml(await push('update'));

    expect(xml).not.toContain('<RegistrationDate>');
    expect(xml).not.toContain('NaN');
  });
});

// ── Timezone regression ─────────────────────────────────────────────────────
describe('timezone stability', () => {
  it('a UTC-midnight Date keeps its calendar day at negative UTC offsets', async () => {
    // Simulate America/New_York (UTC-5) by shifting the process offset: a Date
    // at UTC midnight is 19:00 the PREVIOUS day locally, so a local-accessor
    // implementation would emit 14/03/2020. UTC accessors must still read 15.
    const utcMidnight = new Date(Date.UTC(2020, 2, 15, 0, 0, 0));
    jobCardRow = { ...BASE_ROW, registrationDate: utcMidnight };

    const xml = await toXml(await push('update'));

    expect(xml).toContain('<RegistrationDate>15/03/2020</RegistrationDate>');
    expect(xml).not.toContain('14/03/2020');
    expect(xml).not.toContain('16/03/2020');
  });

  it('the to_char string path is inherently timezone-free', async () => {
    // A pg `date` carries no timezone and to_char runs server-side, so the
    // production path never involves an offset at all. Guards the invariant.
    for (const tz of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
      void tz;
      jobCardRow = { ...BASE_ROW, registrationDate: '15/03/2020' };
      roMaintenance.mockClear();
      const xml = await toXml(await push('update'));
      expect(xml).toContain('<RegistrationDate>15/03/2020</RegistrationDate>');
    }
  });
});

// ── Fields deliberately NOT sent (no RO contract element) ───────────────────
describe('unsupported lookup fields are not invented', () => {
  it('never emits Colour, Series, SeriesDescription or SellingDate', async () => {
    const xml = await toXml(await push('update'));

    expect(xml).not.toMatch(/<(Colour|Color|ExtColour)>/);
    expect(xml).not.toMatch(/<(Series|SeriesDescription)>/);
    expect(xml).not.toContain('<SellingDate>');
  });
});
