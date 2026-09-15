import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRoFranchise } from '../jobCardEvolveSync.service';

// AI-3 (§2.3) — behaviour of resolveRoFranchise, which maps the job card's
// selected Franchise/Service-Dept pair into the RO <FranchiseSeqID>/<ServiceDept>.
// The pair values are populated by loadJobCardForSync's join; here we feed rows
// directly to assert the resolution/fallback contract without a DB.
//
// NOTE: this documents CURRENT confirmed behaviour. It does NOT assert
// "prevention of Other" — preventing the '1'/'1' (="Other") fallback would
// require making the selection mandatory, which is a deferred product decision.

// Minimal row factory — only the fields resolveRoFranchise reads.
const row = (over: Partial<{ franchiseSeqId: string | null; serviceDept: string | null }>) =>
  ({
    id: 'jc-1',
    brand: 'FAW',
    vin: 'VIN123',
    registrationNo: 'KOP64GP',
    franchiseSeqId: null,
    serviceDept: null,
    ...over,
  }) as any;

describe('resolveRoFranchise (AI-3 §2.3)', () => {
  beforeEach(() => {
    // Silence the UNMAPPED_FRANCHISE warning on the fallback paths.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('forwards the selected FAW pair (Franchise FAW = 4 / Service - FAW = 2) to the RO', async () => {
    const res = await resolveRoFranchise(row({ franchiseSeqId: '4', serviceDept: '2' }));
    expect(res).toEqual({ franchiseSeqId: '4', serviceDept: '2' });
  });

  it('forwards any selected pair verbatim (e.g. TATA = 2 / Service - TATA = 1)', async () => {
    const res = await resolveRoFranchise(row({ franchiseSeqId: '2', serviceDept: '1' }));
    expect(res).toEqual({ franchiseSeqId: '2', serviceDept: '1' });
  });

  it('trims surrounding whitespace on the selected pair', async () => {
    const res = await resolveRoFranchise(row({ franchiseSeqId: ' 4 ', serviceDept: ' 2 ' }));
    expect(res).toEqual({ franchiseSeqId: '4', serviceDept: '2' });
  });

  // Fallback documentation: with no selection, resolveRoFranchise returns {},
  // and the XML builder then applies its `?? '1'` default (FranchiseSeqID=1 ==
  // Evolve's "Other" franchise). This captures the CURRENT behaviour and the
  // known risk — it is NOT a prevention guarantee.
  it('returns {} when no franchise is selected (→ RO builder 1/1 = "Other" fallback)', async () => {
    const res = await resolveRoFranchise(row({ franchiseSeqId: null, serviceDept: null }));
    expect(res).toEqual({});
  });

  it('returns {} for an incomplete pair (only FranchiseSeqID, no ServiceDept)', async () => {
    expect(await resolveRoFranchise(row({ franchiseSeqId: '4', serviceDept: null }))).toEqual({});
    expect(await resolveRoFranchise(row({ franchiseSeqId: null, serviceDept: '2' }))).toEqual({});
  });

  it('returns {} for whitespace-only values (treated as unselected)', async () => {
    const res = await resolveRoFranchise(row({ franchiseSeqId: '  ', serviceDept: '  ' }));
    expect(res).toEqual({});
  });
});
