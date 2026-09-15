import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * EVOLVE_ENGINE_NUMBER_MODE — the CREATE-only engine-number gate.
 *
 * Why it exists: on CREATE (blank RONumber) Evolve auto-creates the vehicle
 * master from our payload, so a missing engine number is written into Evolve's
 * vehicle record permanently — and Evolve then refuses to load a labour line
 * under Cost Jobs (observed live: RO FO008450 / reg KFT69FYGP, 2026-09-08).
 *
 * Assertions are on the OUTBOUND CALL COUNT (roMaintenance / lookupRoHistory)
 * and on the persisted state, never on internals: an unwanted Evolve request is
 * the actual defect being prevented. Same harness as jobCardEvolveFreeze.test.ts
 * — env is parsed once at import, so each case re-imports the service.
 */

vi.setConfig({ testTimeout: 30000 });

// ── Test doubles ────────────────────────────────────────────────────────────
let jobCardRow: Record<string, unknown> | null = null;
const dbUpdates: Array<Record<string, unknown>> = [];

function makeSelectChain() {
  const result = () => (jobCardRow ? [jobCardRow] : []);
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
    select: () => makeSelectChain(),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        dbUpdates.push(values);
        // Apply the write so state advances like a real DB.
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
// Spread the real module so pure helpers (normalizeEngineNumber) stay real.
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

/** Total outbound Evolve calls of any kind. */
const outboundCalls = () => roMaintenance.mock.calls.length + lookupRoHistory.mock.calls.length;

const BASE_ROW = {
  id: 'jc-1',
  status: 'IN_PROGRESS',
  totalEstimate: '100.00',
  serviceType: 'Repair',
  jobType: 'INT',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  evolveRoNumber: null as string | null,
  evolveCrmRoRef: 'CRMJC001',
  customerId: 'cust-1',
  custSequenceId: '20EC0002915',
  vin: 'AAK2829FLSB122503',
  registrationNo: 'B122503',
  engineNumber: 'ENG1' as string | null,
  registrationYear: 2020,
  manufacturingYear: 2020,
  odometerLast: 1000,
  brand: 'FAW',
  model: 'J5N',
  modelCode: '18665355',
  roStatus: 'IN_WORKSHOP',
  owningCompanyId: null,
  vehicleCheckInId: 'ci-1',
  serviceAdvisorNumber: 1,
  evolveAttemptCount: 0,
  franchiseSeqId: '4',
  serviceDept: '2',
};

type Mode = 'OFF' | 'LOG' | 'ENFORCE';

async function loadService(mode: Mode) {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/test';
  process.env.EVOLVE_JOB_CARD_SYNC_ENABLED = 'true';
  process.env.EVOLVE_SYNC_FREEZE = 'false';
  process.env.EVOLVE_ENGINE_NUMBER_MODE = mode;
  return import('../jobCardEvolveSync.service');
}

/** Every representation of "we have no engine number". */
const MISSING_VALUES: Array<[string, string | null]> = [
  ['NULL', null],
  ["empty string ''", ''],
  ["whitespace '   '", '   '],
  ['tabs/newlines', '\t\n '],
];

beforeEach(() => {
  jobCardRow = { ...BASE_ROW };
  dbUpdates.length = 0;
  roMaintenance.mockReset();
  lookupRoHistory.mockReset();
  roMaintenance.mockResolvedValue({
    success: true, requestStatus: 'S', rowStatus: 'S',
    roNumber: 'RO-99999', crmReferenceNo: 'CRMJC001', message: null, rawXml: '',
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EVOLVE_ENGINE_NUMBER_MODE;
  delete process.env.EVOLVE_JOB_CARD_SYNC_ENABLED;
  delete process.env.EVOLVE_SYNC_FREEZE;
});

// ── Tests 1-3 — ENFORCE blocks the CREATE for every missing representation ──
describe('Tests 1-3 — ENFORCE: a CREATE with no engine number never reaches Evolve', () => {
  for (const [label, value] of MISSING_VALUES) {
    it(`${label} → roMaintenance is NOT called`, async () => {
      jobCardRow = { ...BASE_ROW, engineNumber: value };
      const svc = await loadService('ENFORCE');

      await svc.syncJobCardToEvolveRo('jc-1');

      expect(roMaintenance).not.toHaveBeenCalled();
      expect(outboundCalls()).toBe(0);
      expect(dbUpdates.some((u) => u.evolveSyncStatus === 'DEFERRED')).toBe(true);
      expect(dbUpdates.some((u) => u.evolveLastError === 'ENGINE_NUMBER_MISSING')).toBe(true);
    });
  }

  it('schedules a retry window so the reconcile sweep can pick it up', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null };
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');

    const deferral = dbUpdates.find((u) => u.evolveSyncStatus === 'DEFERRED');
    expect(deferral?.evolveNextAttemptAt).toBeInstanceOf(Date);
    expect((deferral!.evolveNextAttemptAt as Date).getTime()).toBeGreaterThan(Date.now());
  });
});

// ── Test 4 — the soft defer must not consume the retry budget ───────────────
describe('Test 4 — soft defer does NOT consume retry attempts', () => {
  it('never writes evolveAttemptCount', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null };
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');

    // parkRetryable would have bumped this; parkSoftDefer must not touch it.
    for (const u of dbUpdates) expect(u).not.toHaveProperty('evolveAttemptCount');
    expect(jobCardRow!.evolveAttemptCount).toBe(0);
  });

  it('leaves an already-elevated attempt count untouched', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null, evolveAttemptCount: 3 };
    // attemptCount > 0 routes through duplicate recovery first (see Test 10),
    // so the history lookup must answer before the gate is reached.
    lookupRoHistory.mockResolvedValue({ ok: true, entries: [] });
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');

    expect(jobCardRow!.evolveAttemptCount).toBe(3);
  });
});

// ── Test 5 — a real value proceeds, and is sent verbatim ────────────────────
describe('Test 5 — ENFORCE + a valid engine number', () => {
  it('calls Evolve and forwards the value', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: 'ENG123456' };
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');

    expect(roMaintenance).toHaveBeenCalledTimes(1);
    expect(roMaintenance.mock.calls[0][0]).toMatchObject({
      roNumber: '',                 // blank = CREATE
      engineNumber: 'ENG123456',
    });
  });

  it('normalises a padded value without inventing anything', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: '  ENG123456  ' };
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');

    expect(roMaintenance.mock.calls[0][0].engineNumber).toBe('ENG123456');
  });
});

// ── Tests 6-7 — OFF and LOG are fail-open by design ─────────────────────────
describe('Test 6 — OFF: no behaviour change', () => {
  it('CREATE still goes to Evolve with a NULL engine number', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null };
    const svc = await loadService('OFF');

    await svc.syncJobCardToEvolveRo('jc-1');

    expect(roMaintenance).toHaveBeenCalledTimes(1);
    // Absent stays absent — '' is the "no value" marker the XML builder omits.
    expect(roMaintenance.mock.calls[0][0].engineNumber).toBe('');
    expect(dbUpdates.some((u) => u.evolveLastError === 'ENGINE_NUMBER_MISSING')).toBe(false);
  });

  it('writes no gate-related DB state at all', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null };
    const svc = await loadService('OFF');

    await svc.syncJobCardToEvolveRo('jc-1');

    expect(dbUpdates.some((u) => u.evolveSyncStatus === 'DEFERRED')).toBe(false);
  });
});

describe('Test 7 — LOG: warns but still syncs', () => {
  it('calls Evolve AND logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    jobCardRow = { ...BASE_ROW, engineNumber: null };
    const svc = await loadService('LOG');

    await svc.syncJobCardToEvolveRo('jc-1');

    expect(roMaintenance).toHaveBeenCalledTimes(1);
    const warned = warn.mock.calls.flat().join(' ');
    expect(warned).toContain('has no engine number');
    expect(warned).toContain('would be DEFERRED under ENFORCE');
  });
});

// ── Test 8 — the UPDATE path is never gated ─────────────────────────────────
describe('Test 8 — an existing RO is never blocked by a missing engine number', () => {
  for (const [label, value] of MISSING_VALUES) {
    it(`UPDATE proceeds with ${label} even under ENFORCE`, async () => {
      jobCardRow = { ...BASE_ROW, evolveRoNumber: 'RO-12345', engineNumber: value };
      const svc = await loadService('ENFORCE');

      await svc.syncJobCardUpdateToEvolve('jc-1');

      expect(roMaintenance).toHaveBeenCalledTimes(1);
      expect(roMaintenance.mock.calls[0][0]).toMatchObject({
        roNumber: 'RO-12345',
        engineNumber: '',           // omitted downstream by the XML builder
      });
      expect(dbUpdates.some((u) => u.evolveLastError === 'ENGINE_NUMBER_MISSING')).toBe(false);
    });
  }
});

// ── Test 9 — repeated gate hits can never escalate ──────────────────────────
describe('Test 9 — repeated gate hits never reach NEEDS_MANUAL', () => {
  it('survives more hits than EVOLVE_RO_MAX_ATTEMPTS (default 6)', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null };
    const svc = await loadService('ENFORCE');

    // Simulates a card shared → approved → parts-requested → started …, each of
    // which routes into CREATE while no RO exists.
    for (let i = 0; i < 10; i++) await svc.syncJobCardToEvolveRo('jc-1');

    expect(outboundCalls()).toBe(0);
    expect(dbUpdates.some((u) => u.evolveSyncStatus === 'NEEDS_MANUAL')).toBe(false);
    expect(jobCardRow!.evolveSyncStatus).toBe('DEFERRED');
    expect(jobCardRow!.evolveAttemptCount).toBe(0);
  });

  it('syncs as soon as the engine number is entered — no manual requeue', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null };
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');
    expect(roMaintenance).not.toHaveBeenCalled();

    // Someone fills the field in; the next sweep re-reads it from the DB.
    jobCardRow!.engineNumber = 'ENG777';
    await svc.syncJobCardToEvolveRo('jc-1');

    expect(roMaintenance).toHaveBeenCalledTimes(1);
    expect(roMaintenance.mock.calls[0][0].engineNumber).toBe('ENG777');
  });
});

// ── Test 10 — duplicate recovery runs BEFORE the gate ───────────────────────
describe('Test 10 — duplicate recovery is not starved by the gate', () => {
  it('adopts an RO created by a lost-response CREATE, even with no engine number', async () => {
    // attemptCount > 0 => a prior CREATE may have committed in Evolve.
    jobCardRow = { ...BASE_ROW, engineNumber: null, evolveAttemptCount: 1 };
    lookupRoHistory.mockResolvedValue({
      ok: true,
      entries: [{ roNumber: 'RO-ADOPTED', crmReferenceNo: 'CRMJC001', vin: BASE_ROW.vin }],
    });
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');

    // The gate must NOT have short-circuited the adoption: the orphaned RO is
    // claimed, then the flow switches to UPDATE (which is never gated).
    expect(lookupRoHistory).toHaveBeenCalledTimes(1);
    expect(dbUpdates.some((u) => u.evolveRoNumber === 'RO-ADOPTED')).toBe(true);
    expect(roMaintenance).toHaveBeenCalledTimes(1);
    expect(roMaintenance.mock.calls[0][0]).toMatchObject({ roNumber: 'RO-ADOPTED' });
  });

  it('still defers when history is clean (no orphan to adopt)', async () => {
    jobCardRow = { ...BASE_ROW, engineNumber: null, evolveAttemptCount: 1 };
    lookupRoHistory.mockResolvedValue({ ok: true, entries: [] });
    const svc = await loadService('ENFORCE');

    await svc.syncJobCardToEvolveRo('jc-1');

    expect(lookupRoHistory).toHaveBeenCalledTimes(1);
    expect(roMaintenance).not.toHaveBeenCalled();
    expect(dbUpdates.some((u) => u.evolveLastError === 'ENGINE_NUMBER_MISSING')).toBe(true);
  });
});

// ── Gate unit tests — pure, no DB, no network ───────────────────────────────
describe('gateEngineNumberForCreate (pure)', () => {
  const row = { id: 'jc-1', vin: 'V1', registrationNo: 'R1' };

  it('PROCEEDs on a real value in every mode', async () => {
    for (const mode of ['OFF', 'LOG', 'ENFORCE'] as Mode[]) {
      const svc = await loadService(mode);
      expect(svc.gateEngineNumberForCreate({ ...row, engineNumber: 'ENG1' }))
        .toEqual({ action: 'PROCEED' });
    }
  });

  it('DEFERs every missing representation under ENFORCE', async () => {
    const svc = await loadService('ENFORCE');
    for (const [, value] of MISSING_VALUES) {
      expect(svc.gateEngineNumberForCreate({ ...row, engineNumber: value }))
        .toEqual({ action: 'DEFER', reason: 'ENGINE_NUMBER_MISSING' });
    }
  });

  it('PROCEEDs on every missing representation under OFF and LOG', async () => {
    for (const mode of ['OFF', 'LOG'] as Mode[]) {
      const svc = await loadService(mode);
      for (const [, value] of MISSING_VALUES) {
        expect(svc.gateEngineNumberForCreate({ ...row, engineNumber: value }))
          .toEqual({ action: 'PROCEED' });
      }
    }
  });

  it('never returns a substituted value of any kind', async () => {
    const svc = await loadService('ENFORCE');
    const result = svc.gateEngineNumberForCreate({ ...row, engineNumber: null });
    expect(JSON.stringify(result)).not.toMatch(/UNKNOWN|N\/A|NONE|V1|R1|\d{4,}/i);
  });
});
