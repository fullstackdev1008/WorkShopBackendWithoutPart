import { describe, it, expect } from 'vitest';
import { buildXmlRequest } from '../masterDataSync.service';
import { listFsdQuerySchema } from '../../modules/franchise-service-depts/dto';
import { env } from '../../config/env';

// Company scoping for the Franchise / Service-Dept cache.
//
// Evolve answers IRM_GetLookupDropdownTables per InterfaceCode, so the
// franchise pairs belong to ONE company. Two things must hold or the job-card
// dropdown silently offers the other dealership's franchises:
//
//   1. The per-company sync must actually SEND that company's InterfaceCode.
//      Forgetting to thread it is invisible — the call still succeeds, it just
//      returns the env company's data and tags it with the wrong company id.
//   2. The list endpoint must accept a companyId to filter on.
describe('per-company lookup fetch', () => {
  const bodyFor = (xml: string) =>
    xml.match(/<InterfaceCode>(.*?)<\/InterfaceCode>/)?.[1];

  it('sends the supplied InterfaceCode instead of the env default', () => {
    const xml = buildXmlRequest(
      'IRM_GetLookupDropdownTables',
      { FranchiseServiceDepartments: 'yes' },
      '95112-AGLT-10EC',
    );
    expect(bodyFor(xml)).toBe('95112-AGLT-10EC');
    expect(xml).not.toContain(`<InterfaceCode>${env.EVOLVE_INTERFACE_CODE}</InterfaceCode>`);
  });

  it('falls back to the env default when no code is supplied', () => {
    const xml = buildXmlRequest('IRM_GetLookupDropdownTables', {});
    expect(bodyFor(xml)).toBe(env.EVOLVE_INTERFACE_CODE);
  });

  // A blank/whitespace code must not produce an empty <InterfaceCode>, which
  // Evolve rejects — it degrades to the env default instead.
  it('treats an empty code as absent', () => {
    expect(bodyFor(buildXmlRequest('IRM_GetLookupDropdownTables', {}, ''))).toBe(
      env.EVOLVE_INTERFACE_CODE,
    );
  });

  it('keeps each company distinct across calls', () => {
    const a = bodyFor(buildXmlRequest('IRM_GetLookupDropdownTables', {}, '95112-AGLT-10EC'));
    const b = bodyFor(buildXmlRequest('IRM_GetLookupDropdownTables', {}, '95112-AGLT-20EC'));
    expect(a).not.toBe(b);
  });
});

describe('listFsdQuerySchema companyId', () => {
  it('accepts a uuid companyId', () => {
    const r = listFsdQuerySchema.safeParse({
      companyId: '11111111-2222-3333-4444-555555555555',
    });
    expect(r.success).toBe(true);
  });

  // Omitted must stay valid: existing callers (and the admin screen) send no
  // companyId and must keep getting the unfiltered list.
  it('stays optional', () => {
    const r = listFsdQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.companyId).toBeUndefined();
  });

  it('rejects a non-uuid companyId rather than silently ignoring it', () => {
    const r = listFsdQuerySchema.safeParse({ companyId: '10EC' });
    expect(r.success).toBe(false);
  });

  it('still accepts scope alongside companyId', () => {
    const r = listFsdQuerySchema.safeParse({
      scope: 'all',
      companyId: '11111111-2222-3333-4444-555555555555',
    });
    expect(r.success).toBe(true);
  });
});
