import { describe, it, expect } from 'vitest';
import { interfaceCodeFor, type ResolvedCompany } from '../companyResolver.service';

/**
 * `interfaceCodeFor` is the pure "resolve + validate active" decision behind the
 * API's success vs 400 behaviour:
 *   - non-null result  → the handler proceeds (search/create succeeds)
 *   - null result      → the handler returns 400 (Invalid or inactive company)
 * Testing it here keeps the rule verifiable without DB/HTTP infrastructure.
 */
describe('companyResolver.interfaceCodeFor', () => {
  const active: ResolvedCompany = {
    id: '11111111-1111-1111-1111-111111111111',
    code: '10EC',
    name: '10EC',
    interfaceCode: '95112-AGLT-10EC',
    isActive: true,
  };

  it('active company → returns its InterfaceCode (API proceeds)', () => {
    expect(interfaceCodeFor(active)).toBe('95112-AGLT-10EC');
  });

  it('unknown company (null) → returns null (API → 400)', () => {
    expect(interfaceCodeFor(null)).toBeNull();
  });

  it('inactive company → returns null (API → 400)', () => {
    expect(interfaceCodeFor({ ...active, isActive: false })).toBeNull();
  });
});
