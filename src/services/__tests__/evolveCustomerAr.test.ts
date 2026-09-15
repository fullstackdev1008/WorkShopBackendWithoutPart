import { describe, it, expect } from 'vitest';
import { buildCustomerMaintenanceXml } from '../evolveIrm.service';

/**
 * <AccountsReceivable> on IRM_CustomerMaintenance.
 *
 * Why it exists: Evolve creates no AR master record of its own when a customer
 * is created, so a customer synced without this block has no artArMaster and
 * Evolve then refuses to load a labour line under Cost Jobs (observed live as
 * "No artArMaster Record Available" on RO FO008450).
 *
 * Pure string building — no db, no network.
 */
describe('buildCustomerMaintenanceXml — <AccountsReceivable>', () => {
  const baseDetail = {
    CRMReferenceNo: 'crm-1',
    CustSequenceID: '',
    CustomerType: 'C',
    CompanyName: 'MOLLOY TRANSPORT',
  };

  // The block a fully-populated 20EC customer produces, using the WRITE
  // contract's field names (04a) — which differ from the read contract's.
  const fullAr = {
    AccountType: 'VH',
    AccountNumber: 'TESTVH000001',
    TermsCode: '30',
    CreditLimit: '0.00',
    StopCredit: 'no',
    InActiveAccount: 'no',
    CurrencyCode: 'ZAR',
    DefaultTaxCode: '1',
  };

  it('emits the block with the write-contract field names', () => {
    const xml = buildCustomerMaintenanceXml({ customerDetail: baseDetail, accountsReceivable: fullAr });

    expect(xml).toContain('<AccountsReceivable>');
    expect(xml).toContain('</AccountsReceivable>');
    expect(xml).toContain('<AccountType>VH</AccountType>');
    expect(xml).toContain('<AccountNumber>TESTVH000001</AccountNumber>');
    expect(xml).toContain('<TermsCode>30</TermsCode>');
    expect(xml).toContain('<CreditLimit>0.00</CreditLimit>');
    expect(xml).toContain('<CurrencyCode>ZAR</CurrencyCode>');
    expect(xml).toContain('<DefaultTaxCode>1</DefaultTaxCode>');
  });

  // Guards the read/write naming trap: reusing the parsed shape verbatim would
  // send ArAccountType / CreditLimitAmount / ArAccountNumber / InactiveAccount,
  // none of which the write contract defines.
  it('does not leak the READ contract field names', () => {
    const xml = buildCustomerMaintenanceXml({ customerDetail: baseDetail, accountsReceivable: fullAr });

    expect(xml).not.toContain('<ArAccountType>');
    expect(xml).not.toContain('<ArAccountNumber>');
    expect(xml).not.toContain('<CreditLimitAmount>');
    expect(xml).not.toContain('<InactiveAccount>');   // read spelling
    expect(xml).toContain('<InActiveAccount>');       // write spelling
  });

  // Logicals: the contract documents these as {yes/no} and Evolve returns 'no'
  // on read, so the 04a sample's `false` is illustrative.
  it('carries yes/no logicals rather than true/false', () => {
    const xml = buildCustomerMaintenanceXml({
      customerDetail: baseDetail,
      accountsReceivable: { ...fullAr, StopCredit: 'yes', InActiveAccount: 'no' },
    });
    expect(xml).toContain('<StopCredit>yes</StopCredit>');
    expect(xml).toContain('<InActiveAccount>no</InActiveAccount>');
    expect(xml).not.toContain('<StopCredit>true</StopCredit>');
    expect(xml).not.toContain('<InActiveAccount>false</InActiveAccount>');
  });

  // A customer with no AR data must yield a payload byte-identical to the one
  // produced before this block existed.
  it('omits the block entirely when the caller supplies none', () => {
    const xml = buildCustomerMaintenanceXml({ customerDetail: baseDetail });
    expect(xml).not.toContain('AccountsReceivable');
  });

  it('skips null and undefined members rather than sending them blank', () => {
    const xml = buildCustomerMaintenanceXml({
      customerDetail: baseDetail,
      accountsReceivable: { AccountType: 'VH', AccountNumber: undefined, TermsCode: null },
    });
    expect(xml).toContain('<AccountType>VH</AccountType>');
    expect(xml).not.toContain('<AccountNumber>');
    expect(xml).not.toContain('<TermsCode>');
  });

  it('places the block after CustomerDetail and CustomerProfile', () => {
    const xml = buildCustomerMaintenanceXml({
      customerDetail: baseDetail,
      customerProfile: { Occupation: 'Driver' },
      accountsReceivable: fullAr,
    });
    const detail  = xml.indexOf('<CustomerDetail>');
    const profile = xml.indexOf('<CustomerProfile>');
    const arIdx   = xml.indexOf('<AccountsReceivable>');
    expect(detail).toBeGreaterThan(-1);
    expect(profile).toBeGreaterThan(detail);
    expect(arIdx).toBeGreaterThan(profile);
  });

  it('escapes XML-special characters in AR values', () => {
    const xml = buildCustomerMaintenanceXml({
      customerDetail: baseDetail,
      accountsReceivable: { AccountNumber: 'A&B<1' },
    });
    expect(xml).toContain('<AccountNumber>A&amp;B&lt;1</AccountNumber>');
  });
});
