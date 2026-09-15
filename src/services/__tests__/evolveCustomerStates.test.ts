import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Evolve <CustomerStates> must carry the CUSTOMER's reported complaint, not the
 * work/parts list.
 *
 * The bug: buildRoInput() assigned the same `states` variable — the non-labour
 * job-card line-item descriptions, i.e. the parts — to BOTH customerStates and
 * saInstruction. Evolve therefore displayed
 * "AIR DRIER FILTER ELEMENT; AIR FILTER ELEMENT INNER / PRI; …" where the
 * customer's request belongs.
 *
 * The complaint lives in vehicle_check_ins.complaint_text (auto-filled at gate
 * entry from the booking's appointments.complaints) and was never read.
 *
 * Assertions are on the RoMaintenanceInput handed to roMaintenance(), which is
 * the exact payload the XML builder serialises. No network, no live Evolve call.
 */

vi.setConfig({ testTimeout: 30000 });

// ── Test doubles ────────────────────────────────────────────────────────────
let jobCardRow: Record<string, unknown> | null = null;
let items: Array<Record<string, unknown>> = [];

/**
 * The select double discriminates by PROJECTION KEYS rather than call order:
 * buildRoInput issues several unrelated lookups (appointment date, interface
 * code, service-advisor number, service-type cache) between the job-card load
 * and the item load, so a positional counter would be brittle.
 */
function makeSelectChain(projection?: Record<string, unknown>) {
  const keys = projection ? Object.keys(projection) : [];
  const result = () => {
    if (keys.includes('desc') && keys.includes('partsRequired')) return items;
    if (keys.includes('vin') && keys.includes('custSequenceId')) return jobCardRow ? [jobCardRow] : [];
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
// Spread the real module so pure helpers (e.g. normalizeEngineNumber, used by
// buildRoInput) stay real and a NEW export can never silently break this suite;
// only the network calls are stubbed.
vi.mock('../evolveIrm.service', async (importOriginal) => {
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

// ── Fixtures ────────────────────────────────────────────────────────────────
const BASE_ROW = {
  id: 'jc-1',
  status: 'IN_PROGRESS',
  totalEstimate: '100.00',
  serviceType: 'Repair',
  jobType: 'INT',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  evolveRoNumber: 'RO-12345',
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
  roStatus: 'IN_WORKSHOP',
  complaintText: null as string | null,
  owningCompanyId: null,
  vehicleCheckInId: 'ci-1',
  serviceAdvisorNumber: 1,
  evolveAttemptCount: 0,
  franchiseSeqId: '4',
  serviceDept: '2',
};

/** Parts loaded through TrueGear — exactly the shape seen in the Evolve screenshot. */
const PART_ITEMS = [
  { desc: 'AIR DRIER FILTER ELEMENT', partsRequired: 'P-1001', jobGroup: 1, jobType: 'INT', estimatedHours: null, serviceType: 'Repair', partsCost: '100.00', labourCost: '0', quantity: 1 },
  { desc: 'OIL FILTER',              partsRequired: 'P-1002', jobGroup: 1, jobType: 'INT', estimatedHours: null, serviceType: 'Repair', partsCost: '50.00',  labourCost: '0', quantity: 2 },
];

const PARTS_TEXT = 'AIR DRIER FILTER ELEMENT; OIL FILTER';
const COMPLAINT = 'Engine making a knocking noise when cold';

async function loadService(multiJob = false) {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/test';
  process.env.EVOLVE_JOB_CARD_SYNC_ENABLED = 'true';
  process.env.EVOLVE_SYNC_FREEZE = 'false';
  process.env.EVOLVE_RO_MULTI_JOB_ENABLED = multiJob ? 'true' : 'false';
  return import('../jobCardEvolveSync.service');
}

/** Run an RO update push and return the RoMaintenanceInput that was sent. */
async function pushAndCapture(multiJob = false): Promise<any> {
  const svc = await loadService(multiJob);
  await svc.syncJobCardUpdateToEvolve('jc-1');
  expect(roMaintenance).toHaveBeenCalled();
  return roMaintenance.mock.calls[0][0];
}

beforeEach(() => {
  jobCardRow = { ...BASE_ROW };
  items = PART_ITEMS.map((i) => ({ ...i }));
  roMaintenance.mockReset();
  lookupRoHistory.mockReset();
  roMaintenance.mockResolvedValue({
    success: true, requestStatus: 'S', rowStatus: 'S',
    roNumber: 'RO-12345', crmReferenceNo: 'crm-jc-1', message: null, rawXml: '',
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EVOLVE_RO_MULTI_JOB_ENABLED;
});

// ── CustomerStates now carries the complaint ────────────────────────────────
describe('CustomerStates uses the customer complaint', () => {
  it('sends the complaint, NOT the parts list', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: COMPLAINT };

    const payload = await pushAndCapture();

    expect(payload.customerStates).toBe(COMPLAINT);
    // NEGATIVE CONTROL: this is precisely what the old mapping produced. Under
    // the previous code customerStates === the parts text and both assertions
    // below would fail — so these tests cannot pass against the old mapping.
    expect(payload.customerStates).not.toBe(PARTS_TEXT);
    expect(payload.customerStates).not.toContain('AIR DRIER FILTER ELEMENT');
  });

  it('trims surrounding whitespace from the complaint', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: `   ${COMPLAINT}   ` };

    expect((await pushAndCapture()).customerStates).toBe(COMPLAINT);
  });

  it('is unaffected by parts loaded through TrueGear', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: COMPLAINT };
    // Simulate parts-manager appending supplementary part lines.
    items = [
      ...PART_ITEMS,
      { desc: 'FUEL FILTER DIESEL', partsRequired: 'P-2001', jobGroup: 1, jobType: 'INT', estimatedHours: null, serviceType: 'Repair', partsCost: '75.00', labourCost: '0', quantity: 1 },
    ];

    const payload = await pushAndCapture();

    expect(payload.customerStates).toBe(COMPLAINT);
    expect(payload.customerStates).not.toContain('FUEL FILTER DIESEL');
  });
});

// ── Fallback: never blank ───────────────────────────────────────────────────
describe('CustomerStates falls back to the work-derived value', () => {
  for (const [label, blank] of [
    ['NULL', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ] as const) {
    it(`falls back to \`states\` when the complaint is ${label}`, async () => {
      jobCardRow = { ...BASE_ROW, complaintText: blank };

      const payload = await pushAndCapture();

      expect(payload.customerStates).toBe(PARTS_TEXT);
      expect(payload.customerStates).not.toBe('');
    });
  }

  it('never emits a blank CustomerStates even with no complaint and no items', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: null };
    items = [];

    // Existing behaviour: `states` itself falls back to serviceType.
    expect((await pushAndCapture()).customerStates).toBe('Repair');
  });
});

// ── 250-character cap ───────────────────────────────────────────────────────
describe('250-character limit', () => {
  it('truncates a long complaint to 250 characters', async () => {
    const long = 'A'.repeat(400);
    jobCardRow = { ...BASE_ROW, complaintText: long };

    const payload = await pushAndCapture();

    expect(payload.customerStates).toHaveLength(250);
    expect(payload.customerStates).toBe('A'.repeat(250));
  });

  it('leaves a complaint at exactly 250 characters intact', async () => {
    const exact = 'B'.repeat(250);
    jobCardRow = { ...BASE_ROW, complaintText: exact };

    expect((await pushAndCapture()).customerStates).toBe(exact);
  });
});

// ── SAInstruction stays separate ────────────────────────────────────────────
describe('SAInstruction is a separate field', () => {
  it('keeps the work/parts-derived value when a complaint exists', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: COMPLAINT };

    const payload = await pushAndCapture();

    expect(payload.saInstruction).toBe(PARTS_TEXT);
    // The regression this guards: the two fields were literally the same
    // variable. They must no longer move together.
    expect(payload.saInstruction).not.toBe(payload.customerStates);
  });

  it('does not mirror the complaint', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: COMPLAINT };

    expect((await pushAndCapture()).saInstruction).not.toContain('knocking noise');
  });
});

// ── Parts still reach their own destinations ────────────────────────────────
describe('parts flow is unchanged', () => {
  it('parts still drive the estimate and the SA instruction text', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: COMPLAINT };

    const payload = await pushAndCapture();

    // Single-block path takes the estimate from the job-card total (not a
    // per-item sum); unchanged by this fix.
    expect(payload.valueCpaEstimate).toBe(BASE_ROW.totalEstimate);
    expect(payload.saInstruction).toContain('AIR DRIER FILTER ELEMENT');
    expect(payload.saInstruction).toContain('OIL FILTER');
  });
});

// ── Multi-job path (flag currently off in production) ────────────────────────
describe('multi-job path', () => {
  it('repeats the card-level complaint on every job block', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: COMPLAINT };
    items = [
      { desc: 'AIR DRIER FILTER ELEMENT', partsRequired: 'P-1001', jobGroup: 1, jobType: 'INT', estimatedHours: null, serviceType: 'Repair', partsCost: '100.00', labourCost: '0', quantity: 1 },
      { desc: 'OIL FILTER',              partsRequired: 'P-1002', jobGroup: 2, jobType: 'INT', estimatedHours: null, serviceType: 'Repair', partsCost: '50.00',  labourCost: '0', quantity: 1 },
    ];

    const payload = await pushAndCapture(true);

    expect(payload.jobs).toHaveLength(2);
    for (const job of payload.jobs) {
      expect(job.customerStates).toBe(COMPLAINT);
    }
    // SAInstruction stays PER-JOB work text — no job-specific complaint invented.
    expect(payload.jobs[0].saInstruction).toBe('AIR DRIER FILTER ELEMENT');
    expect(payload.jobs[1].saInstruction).toBe('OIL FILTER');
  });

  it('falls back per the card when no complaint exists', async () => {
    jobCardRow = { ...BASE_ROW, complaintText: null };

    const payload = await pushAndCapture(true);

    for (const job of payload.jobs) {
      expect(job.customerStates).toBe(PARTS_TEXT);
    }
  });
});
