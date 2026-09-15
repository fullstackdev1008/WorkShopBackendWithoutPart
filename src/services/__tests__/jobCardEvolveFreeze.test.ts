import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * EVOLVE_SYNC_FREEZE — full job-card freeze for the ENTIRE lifecycle.
 *
 * Acceptance criterion under test: with the flag on, Evolve receives absolutely
 * nothing for a job card — CREATE included — while the local workflow is
 * unaffected.
 *
 * Every assertion is on the OUTBOUND CALL COUNT (roMaintenance /
 * lookupRoHistory), not on database state: the RO payload is rebuilt from live
 * DB state on each push, so an unwanted request would otherwise be invisible.
 *
 * env is parsed once at import, so each case re-imports the service with the
 * flag set.
 */

// Each case re-imports the sync service through vi.resetModules(); the first
// import transforms the whole service graph and can exceed the 5s default when
// the suite runs in parallel. File-scoped so no other test is affected.
vi.setConfig({ testTimeout: 30000 });

// ── Test doubles ────────────────────────────────────────────────────────────
let jobCardRow: Record<string, unknown> | null = null;
const dbUpdates: Array<Record<string, unknown>> = [];
let reconcileRows: Array<Record<string, unknown>> = [];
/** Which table the current select() chain is reading, so reconcile can differ. */
let selectMode: 'row' | 'reconcile' = 'row';

function makeSelectChain() {
  // The reconcile sweep issues ONE query for its candidate rows, then each card
  // is re-loaded with the full job-card shape. Serve the sweep result once, then
  // fall back to the row — mirroring the real query sequence.
  const result = () => {
    if (selectMode === 'reconcile') {
      selectMode = 'row';
      return reconcileRows;
    }
    return jobCardRow ? [jobCardRow] : [];
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
    select: () => makeSelectChain(),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        dbUpdates.push(values);
        // Apply the write so state advances like a real DB (the recovery path
        // depends on the adopted RO number becoming visible on reload).
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
  owningCompanyId: null,
  vehicleCheckInId: 'ci-1',
  serviceAdvisorNumber: 1,
  evolveAttemptCount: 0,
  franchiseSeqId: '4',
  serviceDept: '2',
};

/** A card already created in Evolve (has an RO number). */
const SYNCED_ROW = { ...BASE_ROW, evolveRoNumber: 'RO-12345' };

async function loadService(freeze: boolean) {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/test';
  process.env.EVOLVE_JOB_CARD_SYNC_ENABLED = 'true';
  process.env.EVOLVE_SYNC_FREEZE = freeze ? 'true' : 'false';
  return import('../jobCardEvolveSync.service');
}

beforeEach(() => {
  jobCardRow = { ...SYNCED_ROW };
  reconcileRows = [{ id: 'jc-1', roNumber: 'RO-12345' }];
  selectMode = 'row';
  dbUpdates.length = 0;
  roMaintenance.mockReset();
  lookupRoHistory.mockReset();
  roMaintenance.mockResolvedValue({
    success: true, requestStatus: 'S', rowStatus: 'S',
    roNumber: 'RO-12345', crmReferenceNo: 'crm-jc-1', message: null, rawXml: '',
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EVOLVE_SYNC_FREEZE;
  delete process.env.EVOLVE_JOB_CARD_SYNC_ENABLED;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('flag OFF — existing behaviour is unchanged', () => {
  it('SA create still CREATEs in Evolve (blank RONumber)', async () => {
    jobCardRow = { ...BASE_ROW };
    roMaintenance.mockResolvedValue({
      success: true, requestStatus: 'S', rowStatus: 'S',
      roNumber: 'RO-99999', crmReferenceNo: 'crm-jc-1', message: null, rawXml: '',
    });

    const svc = await loadService(false);
    await svc.syncJobCardToEvolveRo('jc-1');

    expect(roMaintenance).toHaveBeenCalledTimes(1);
    expect(roMaintenance.mock.calls[0][0]).toMatchObject({ roNumber: '' });
    expect(dbUpdates.some((u) => u.evolveRoNumber === 'RO-99999' && u.evolveSyncStatus === 'SYNCED')).toBe(true);
  });

  it('a later update still UPDATEs in Evolve (populated RONumber)', async () => {
    const svc = await loadService(false);
    await svc.syncJobCardUpdateToEvolve('jc-1');

    expect(roMaintenance).toHaveBeenCalledTimes(1);
    expect(roMaintenance.mock.calls[0][0]).toMatchObject({ roNumber: 'RO-12345' });
  });

  it('a failed CREATE still parks for retry', async () => {
    jobCardRow = { ...BASE_ROW };
    roMaintenance.mockResolvedValue({
      success: false, requestStatus: 'F', rowStatus: 'F',
      roNumber: null, crmReferenceNo: null, message: 'MOCK failure', rawXml: '',
    });

    const svc = await loadService(false);
    await svc.syncJobCardToEvolveRo('jc-1');

    expect(roMaintenance).toHaveBeenCalledTimes(1);
    expect(dbUpdates.some((u) => u.evolveSyncStatus === 'FAILED')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('flag ON — SA creates a Job Card: nothing reaches Evolve', () => {
  it('the CREATE path sends zero outbound calls', async () => {
    jobCardRow = { ...BASE_ROW }; // brand-new card, no RO number

    const svc = await loadService(true);
    await svc.syncJobCardToEvolveRo('jc-1');

    expect(outboundCalls()).toBe(0);
  });

  it('leaves the new card completely untouched — no RO number, no sync state', async () => {
    jobCardRow = { ...BASE_ROW };

    const svc = await loadService(true);
    await svc.syncJobCardToEvolveRo('jc-1');

    // No crm-ref write, no PENDING, no attempt counter — the guard runs before
    // any row is even loaded.
    expect(dbUpdates).toEqual([]);
    expect(jobCardRow.evolveRoNumber).toBeNull();
  });

  it('never throws, so the SA create request is unaffected', async () => {
    jobCardRow = { ...BASE_ROW };
    const svc = await loadService(true);
    await expect(svc.syncJobCardToEvolveRo('jc-1')).resolves.toBeUndefined();
  });

  it('an update on a card with no RO does not fall through to CREATE', async () => {
    jobCardRow = { ...BASE_ROW };

    const svc = await loadService(true);
    await svc.syncJobCardUpdateToEvolve('jc-1'); // would normally route to CREATE

    expect(outboundCalls()).toBe(0);
    expect(dbUpdates).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('flag ON — every update path is frozen', () => {
  // All technician/foreman/QC/washbay/gate/status paths converge on
  // syncJobCardUpdateToEvolve (directly or via setRoStatus), so repeated
  // invocations stand in for the full set of callers.
  it('suppresses technician assignment, start, completion, sign-off, QC and status pushes', async () => {
    const svc = await loadService(true);
    await svc.syncJobCardUpdateToEvolve('jc-1'); // assignTechnician
    await svc.syncJobCardUpdateToEvolve('jc-1'); // startTechnicianWork
    await svc.syncJobCardUpdateToEvolve('jc-1'); // completeItemWork (direct)
    await svc.syncJobCardUpdateToEvolve('jc-1'); // completeItemWork (setRoStatus)
    await svc.syncJobCardUpdateToEvolve('jc-1'); // signOffJobCard
    await svc.syncJobCardUpdateToEvolve('jc-1'); // QC Out / washbay / gate release

    expect(outboundCalls()).toBe(0);
  });

  it('does not mark the card FAILED/DEFERRED or touch retry counters', async () => {
    const svc = await loadService(true);
    await svc.syncJobCardUpdateToEvolve('jc-1');

    expect(dbUpdates).toEqual([]);
  });

  it('a card already synced before the freeze was enabled is frozen too', async () => {
    jobCardRow = { ...SYNCED_ROW, evolveRoNumber: 'RO-LEGACY-001', evolveSyncStatus: 'SYNCED' };
    const svc = await loadService(true);
    await svc.syncJobCardUpdateToEvolve('jc-1');

    expect(outboundCalls()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('flag ON — reconcile cron and duplicate recovery are frozen', () => {
  it('the reconcile sweep scans nothing and sends nothing', async () => {
    selectMode = 'reconcile';
    const svc = await loadService(true);
    const res = await svc.reconcileUnsyncedJobCards(50);

    expect(res).toEqual({ scanned: 0 });
    expect(outboundCalls()).toBe(0);
    expect(dbUpdates).toEqual([]);
  });

  it('duplicate-recovery never runs — no RO-history lookup is issued', async () => {
    // A retry (attemptCount > 0) with no RO would normally trigger
    // lookupRoHistory before deciding CREATE vs adopt.
    jobCardRow = { ...BASE_ROW, evolveAttemptCount: 1 };
    lookupRoHistory.mockResolvedValue({ ok: true, entries: [] });

    const svc = await loadService(true);
    await svc.syncJobCardToEvolveRo('jc-1');

    expect(lookupRoHistory).not.toHaveBeenCalled();
    expect(outboundCalls()).toBe(0);
  });

  it('flag OFF: the reconcile sweep still runs (regression guard)', async () => {
    selectMode = 'reconcile';
    const svc = await loadService(false);
    const res = await svc.reconcileUnsyncedJobCards(50);

    expect(res.scanned).toBe(1);
    expect(roMaintenance).toHaveBeenCalledTimes(1); // routed to UPDATE
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('customer sync is frozen too (IRM_CustomerMaintenance)', () => {
  /** Re-import the customer sync service with the flag set. */
  async function loadCustomerService(freeze: boolean) {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/test';
    process.env.EVOLVE_CUSTOMER_SYNC_ENABLED = 'true';
    process.env.EVOLVE_SYNC_FREEZE = freeze ? 'true' : 'false';
    return import('../customerEvolveSync.service');
  }

  afterEach(() => {
    delete process.env.EVOLVE_CUSTOMER_SYNC_ENABLED;
  });

  it('flag ON: the customer push sends nothing and writes nothing', async () => {
    const svc = await loadCustomerService(true);
    await svc.syncCustomerToEvolve('cust-1');

    expect(outboundCalls()).toBe(0);
    expect(dbUpdates).toEqual([]);
  });

  it('flag ON: the customer reconcile sweep scans nothing', async () => {
    const svc = await loadCustomerService(true);
    const res = await svc.reconcileUnsyncedCustomers(50);

    expect(res).toEqual({ scanned: 0 });
    expect(outboundCalls()).toBe(0);
  });

  it('flag ON: the transport backstop blocks a direct customerMaintenance call', async () => {
    vi.resetModules();
    process.env.EVOLVE_SYNC_FREEZE = 'true';
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/test';
    // Import the REAL client (not the mock) to exercise the backstop itself.
    const irm = await vi.importActual<typeof import('../evolveIrm.service')>('../evolveIrm.service');

    await expect(
      irm.customerMaintenance({ customerDetail: {}, customerProfile: {} } as any),
    ).rejects.toThrow(/BLOCKED: IRM_CustomerMaintenance/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('flag ON — full lifecycle simulation', () => {
  it('SA create → assign → start → complete → sign-off → cron: zero Evolve calls', async () => {
    jobCardRow = { ...BASE_ROW }; // fresh card
    const svc = await loadService(true);

    await svc.syncJobCardToEvolveRo('jc-1');      // SA creates
    await svc.syncJobCardUpdateToEvolve('jc-1');  // technician assigned
    await svc.syncJobCardUpdateToEvolve('jc-1');  // work started
    await svc.syncJobCardUpdateToEvolve('jc-1');  // item completed
    await svc.syncJobCardUpdateToEvolve('jc-1');  // RO status → QC_OUT
    await svc.syncJobCardUpdateToEvolve('jc-1');  // foreman sign-off
    selectMode = 'reconcile';
    await svc.reconcileUnsyncedJobCards(50);      // cron sweep

    expect(outboundCalls()).toBe(0);
    // The card never acquired an Evolve identity of any kind.
    expect(dbUpdates).toEqual([]);
    expect(jobCardRow.evolveRoNumber).toBeNull();
  });
});
