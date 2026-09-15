import { describe, it, expect } from 'vitest';
import { parseArAccounts, renderRoJobHeaderRows, buildRoMaintenanceXml } from '../evolveIrm.service';

/**
 * Evolve AR (Accounts Receivable) accounts → RO <ROJobHeader><ARAccountNo>.
 *
 * Context: Evolve refuses to load a labour line under Cost Jobs when the
 * customer has no AR master record ("No artArMaster Record Available",
 * observed live on RO FO008450). The account is now selected on the job card
 * and posted per job.
 *
 * Both halves under test are pure — no DB, no network.
 */

describe('parseArAccounts', () => {
  // The shape a live 20EC IRM_CustomerLookup actually returned (2026-09-09).
  const liveSingle = {
    RowDetails: {
      RowID: 1,
      DbArSeqID: 'AR0000002936',
      ArAccountNumber: 'TESTVH000001',
      ArAccountType: 'VH',
      ArTypeDescrip: 'Retail Vehicles',
      InactiveAccount: 'no',
      StopCredit: 'no',
      CreditLimitAmount: 0,
      CreditAvailableAmount: 0,
    },
  };

  it('reads the live RowDetails shape', () => {
    const accounts = parseArAccounts(liveSingle);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      arSeqId: 'AR0000002936',
      accountNumber: 'TESTVH000001',
      accountType: 'VH',
      typeDescription: 'Retail Vehicles',
      inactive: false,
      stopCredit: false,
    });
  });

  // The regression this parser exists for: the older single-account reader did
  // Object.entries() over the AR block, so a REPEATED RowDetails (an array)
  // yielded index keys and silently dropped every account.
  it('reads MULTIPLE accounts from a repeated RowDetails', () => {
    const accounts = parseArAccounts({
      RowDetails: [
        { DbArSeqID: 'AR1', ArAccountNumber: 'VH0001', ArAccountType: 'VH', ArTypeDescrip: 'Retail Vehicles' },
        { DbArSeqID: 'AR2', ArAccountNumber: 'PT0002', ArAccountType: 'PT', ArTypeDescrip: 'Parts' },
        { DbArSeqID: 'AR3', ArAccountNumber: 'SV0003', ArAccountType: 'SV', ArTypeDescrip: 'Service' },
      ],
    });
    expect(accounts.map((a) => a.accountNumber)).toEqual(['VH0001', 'PT0002', 'SV0003']);
    expect(accounts.map((a) => a.accountType)).toEqual(['VH', 'PT', 'SV']);
  });

  // The shape 03b_CustomerLookup_Response documents: named per-department
  // sub-blocks with AccountNumber/ArSeqID instead of ArAccountNumber/DbArSeqID.
  it('reads the documented per-type shape with its different field names', () => {
    const accounts = parseArAccounts({
      PartsType:     { ArSeqID: 'S1', AccountNumber: 'PT0001', ArAccountType: 'PT', ArTypeDescrip: 'Parts' },
      VehicleType:   { ArSeqID: 'S2', AccountNumber: 'VH0001', ArAccountType: 'VH', ArTypeDescrip: 'Vehicles' },
      ServiceType:   { ArSeqID: 'S3', AccountNumber: 'SV0001', ArAccountType: 'SV', ArTypeDescrip: 'Service' },
      ForecourtType: { ArSeqID: 'S4', AccountNumber: '',       ArAccountType: 'FC', ArTypeDescrip: 'Forecourt' },
    });
    // The blank ForecourtType account is skipped — never offer a blank option.
    expect(accounts.map((a) => a.accountNumber)).toEqual(['PT0001', 'VH0001', 'SV0001']);
    expect(accounts[0].arSeqId).toBe('S1');
  });

  it('maps the yes/no logicals to booleans', () => {
    const [a] = parseArAccounts({
      RowDetails: { ArAccountNumber: 'X1', InactiveAccount: 'yes', StopCredit: 'yes' },
    });
    expect(a.inactive).toBe(true);
    expect(a.stopCredit).toBe(true);
  });

  it('unwraps the parser\'s #text nodes', () => {
    const [a] = parseArAccounts({
      RowDetails: { ArAccountNumber: { '#text': 'TESTVH000001' }, ArAccountType: { '#text': 'VH' } },
    });
    expect(a.accountNumber).toBe('TESTVH000001');
    expect(a.accountType).toBe('VH');
  });

  it('de-duplicates the same account number', () => {
    const accounts = parseArAccounts({
      RowDetails: [{ ArAccountNumber: 'VH0001' }, { ArAccountNumber: 'VH0001' }],
    });
    expect(accounts).toHaveLength(1);
  });

  it('returns [] for an empty, blank or missing AR block', () => {
    expect(parseArAccounts(undefined)).toEqual([]);
    expect(parseArAccounts(null)).toEqual([]);
    expect(parseArAccounts({})).toEqual([]);
    expect(parseArAccounts('   ')).toEqual([]);
    // Present but with no account number → nothing selectable.
    expect(parseArAccounts({ RowDetails: { ArAccountType: 'VH' } })).toEqual([]);
  });
});

describe('renderRoJobHeaderRows — <ARAccountNo>', () => {
  it('emits the account on the job that carries it', () => {
    const xml = renderRoJobHeaderRows([
      { jobNumber: '01', jobType: 'CST', arAccountNo: 'TESTVH000001', customerStates: 'X', saInstruction: 'X' },
    ]);
    expect(xml).toContain('<ARAccountNo>TESTVH000001</ARAccountNo>');
  });

  // Same rule as <EngineNumber>: a blank could overwrite what Evolve holds on an
  // UPDATE, and a cash job legitimately has no account.
  it('omits the element entirely when absent, blank or whitespace', () => {
    for (const job of [
      { jobNumber: '01', customerStates: 'X', saInstruction: 'X' },
      { jobNumber: '01', arAccountNo: '', customerStates: 'X', saInstruction: 'X' },
      { jobNumber: '01', arAccountNo: '   ', customerStates: 'X', saInstruction: 'X' },
    ]) {
      expect(renderRoJobHeaderRows([job])).not.toContain('<ARAccountNo>');
    }
  });

  it('keeps each job on its own account in a multi-job RO', () => {
    const xml = renderRoJobHeaderRows([
      { jobNumber: '01', jobType: 'CST', arAccountNo: 'VH0001', customerStates: 'A', saInstruction: 'A' },
      { jobNumber: '02', jobType: 'CSH', customerStates: 'B', saInstruction: 'B' },
    ]);
    expect(xml.match(/<ARAccountNo>/g)?.length).toBe(1);
    expect(xml).toContain('<ARAccountNo>VH0001</ARAccountNo>');
  });

  it('escapes XML-special characters in the account number', () => {
    const xml = renderRoJobHeaderRows([
      { jobNumber: '01', arAccountNo: 'A&B<1', customerStates: 'X', saInstruction: 'X' },
    ]);
    expect(xml).toContain('<ARAccountNo>A&amp;B&lt;1</ARAccountNo>');
  });
});

/**
 * The single-job block is what renders whenever `jobs` is absent — i.e.
 * whenever EVOLVE_RO_MULTI_JOB_ENABLED is off, which is the DEFAULT. These
 * assertions exist because the first cut of this feature only populated the
 * per-job path, so a selected AR account was stored locally and silently never
 * sent on every default-configured deployment.
 */
describe('buildRoMaintenanceXml — <ARAccountNo> on the single-job block', () => {
  const baseRo = {
    crmReferenceNo: 'crm-1',
    ownerCustSequenceId: '20EC0002915',
    vin: 'AAK2829FLSB122503',
    make: 'FAW',
    modelCode: '18665355',
  };

  it('sends the card-level account when no jobs array is supplied (multi-job off)', () => {
    const xml = buildRoMaintenanceXml({ ...baseRo, arAccountNo: 'TESTVH000001' });
    expect(xml).toContain('<ARAccountNo>TESTVH000001</ARAccountNo>');
  });

  it('omits the element when no account was chosen', () => {
    expect(buildRoMaintenanceXml({ ...baseRo })).not.toContain('<ARAccountNo>');
    expect(buildRoMaintenanceXml({ ...baseRo, arAccountNo: '   ' })).not.toContain('<ARAccountNo>');
  });

  it('lets the per-job value win when a jobs array IS supplied (multi-job on)', () => {
    const xml = buildRoMaintenanceXml({
      ...baseRo,
      arAccountNo: 'CARD0001',
      jobs: [{ jobNumber: '01', arAccountNo: 'JOB0001', customerStates: 'X', saInstruction: 'X' }],
    });
    expect(xml).toContain('<ARAccountNo>JOB0001</ARAccountNo>');
    expect(xml).not.toContain('CARD0001');
  });
});
