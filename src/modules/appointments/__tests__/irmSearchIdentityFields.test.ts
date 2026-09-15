import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IRM customer-search → customer identity fields (regNo / title / initial).
 *
 * WHY THIS EXISTS
 * `createAppointmentSchema`'s `newCustomer.superRefine` requires regNo for a
 * company and title + initial for an individual. buildIrmSearchEntry mapped
 * neither, so a customer found in Evolve but not yet local could not produce a
 * valid booking from ANY client — the values existed in Evolve's response and
 * were discarded at this mapper.
 *
 * THE TRAP THIS GUARDS
 * The same function holds two unrelated things called "reg":
 *
 *   const regNo = vd.RegistrationNo ...   ← VEHICLE number plate
 *   regNo:       cd.RegNo                 ← COMPANY registration number
 *
 * Crossing them yields a response that satisfies every schema while writing a
 * number plate onto a customer record — silent data corruption. The dedicated
 * test below fails if they are ever swapped.
 *
 * The DB and the Evolve persist call are mocked: this asserts the pure mapping
 * from an Evolve payload to the API response, with no network and no database.
 */

// ── Test doubles ────────────────────────────────────────────────────────────
vi.mock('../../../db', () => {
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
    then: (res: any) => Promise.resolve([]).then(res),
  };
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: async (fn: any) => fn({}),
    },
  };
});

// Persisting is a side effect of the real mapper; stubbed so the test asserts
// the response shape only. Returning a null id keeps localCustomerId null,
// which is exactly the "found in Evolve, not yet local" case under test.
vi.mock('../../../services/evolveCustomerPersist.service', () => ({
  persistEvolveCustomer: vi.fn(async () => ({ customerId: null })),
}));

vi.mock('../../../services/companyResolver.service', () => ({
  companyResolver: { getById: vi.fn(async () => null), resolveInterfaceCode: vi.fn(async () => undefined) },
}));

import { buildIrmSearchEntry } from '../service';

/** A lookup result shaped like a real Evolve response. */
const lookupResult = (
  customerDetail: Record<string, string>,
  vehicles: Record<string, string> = {},
): any => ({
  found: true,
  CustomerDetail: customerDetail,
  CustomerProfile: {},
  Vehicles: vehicles,
  VehiclesAll: [],
  AccountsReceivable: {},
});

// Values as the response parser delivers them — already trimmed.
const company = {
  CRMReferenceNo: 'CRM-1',
  CustSequenceID: '20EC0003013',
  CustomerType: 'C',
  CompanyName: 'MOLLOY TRANSPORT',
  RegNo: '2019/123456/07',
  Title: 'Ms',
  Initial: 'P',
  IDNumber: '',
  CellphoneCode: '082',
  CellphoneNumber: '4569874',
  PrimaryEmail: 'fredb@eltgroup.co.za',
};

describe('buildIrmSearchEntry — customer identity fields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns RegNo, Title and Initial from the customer detail', async () => {
    const entry = await buildIrmSearchEntry(lookupResult(company), '');

    expect(entry.regNo).toBe('2019/123456/07');
    expect(entry.title).toBe('Ms');
    expect(entry.initial).toBe('P');
  });

  it('maps an individual\'s title and initial too', async () => {
    const entry = await buildIrmSearchEntry(
      lookupResult({
        ...company,
        CustomerType: 'P',
        CompanyName: '',
        RegNo: '',
        FirstName: 'Paula',
        LastName: 'Molloy',
        IDNumber: '8001015009087',
      }),
      '',
    );

    expect(entry.title).toBe('Ms');
    expect(entry.initial).toBe('P');
    expect(entry.idNumber).toBe('8001015009087');
    expect(entry.firstName).toBe('Paula');
  });

  // Evolve legitimately returns a blank RegNo for many companies — a real
  // answer, not an error, and not something to substitute a value for.
  it('passes a blank RegNo through as empty without throwing', async () => {
    const entry = await buildIrmSearchEntry(
      lookupResult({ ...company, RegNo: '' }),
      '',
    );

    expect(entry.regNo).toBe('');
    expect(entry.companyName).toBe('MOLLOY TRANSPORT');
  });

  it('defaults to empty when the fields are absent entirely', async () => {
    const { RegNo: _r, Title: _t, Initial: _i, ...withoutIdentity } = company;
    const entry = await buildIrmSearchEntry(lookupResult(withoutIdentity), '');

    expect(entry.regNo).toBe('');
    expect(entry.title).toBe('');
    expect(entry.initial).toBe('');
  });

  // THE DATA-INTEGRITY TEST. Fails if cd.RegNo and vd.RegistrationNo are
  // ever crossed.
  it('never uses the VEHICLE registration as the customer regNo', async () => {
    const entry = await buildIrmSearchEntry(
      lookupResult(
        { ...company, RegNo: '' }, // customer has NO company reg number …
        {
          RegistrationNo: 'SERV01GP', // … but the vehicle has a plate
          VehVinNumber: 'QWERTASDFGZXCV147',
          Make: 'FAW',
        },
      ),
      '',
    );

    expect(entry.regNo).toBe('');
    expect(entry.regNo).not.toBe('SERV01GP');
    // The plate must still reach the vehicle block, where it belongs.
    expect(entry.vehicle?.registrationNumber).toBe('SERV01GP');
    expect(entry.vehicle?.vin).toBe('QWERTASDFGZXCV147');
  });

  it('leaves every pre-existing response field unchanged', async () => {
    const entry = await buildIrmSearchEntry(
      lookupResult(company, { RegistrationNo: 'SERV01GP', Make: 'FAW' }),
      '',
    );

    expect(entry.crmReferenceNo).toBe('CRM-1');
    expect(entry.custSequenceId).toBe('20EC0003013');
    expect(entry.customerType).toBe('C');
    expect(entry.companyName).toBe('MOLLOY TRANSPORT');
    // Company → first/last deliberately blanked by the existing isCompany rule.
    expect(entry.firstName).toBe('');
    expect(entry.lastName).toBe('');
    expect(entry.phone).toBe('0824569874');
    expect(entry.email).toBe('fredb@eltgroup.co.za');
    expect(entry.localCustomerId).toBeNull();
    expect(entry.vehicle).not.toBeNull();
  });
});
