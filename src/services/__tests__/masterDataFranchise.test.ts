import { describe, it, expect } from 'vitest';
import { mapFranchiseServiceDepartmentRow } from '../masterDataSync.service';

// AI-3 — guards the parser that maps Evolve's FranchiseServiceDepartments rows
// into the cache. This is the exact logic whose absence caused franchise labels
// to come back null (dropdown empty). The live production row shape (20EC) is:
//   <Franshise>FAW</Franshise><FranchiseSeqID>4</FranchiseSeqID>
//   <SDName>Service - FAW</SDName><SDNumber>2</SDNumber>
describe('mapFranchiseServiceDepartmentRow', () => {
  it('maps the live row shape (Franshise [sic] + SDName + numbers)', () => {
    expect(
      mapFranchiseServiceDepartmentRow({
        Franshise: 'FAW',
        FranchiseSeqID: '4',
        SDName: 'Service - FAW',
        SDNumber: '2',
      }),
    ).toEqual({
      franchiseSeqId: '4',
      sdNumber: '2',
      franchiseLabel: 'FAW',
      serviceDeptLabel: 'Service - FAW',
    });
  });

  it('tolerates the correctly-spelled "Franchise" tag', () => {
    const r = mapFranchiseServiceDepartmentRow({
      Franchise: 'TATA',
      FranchiseSeqID: '2',
      SDName: 'Service - TATA',
      SDNumber: '1',
    });
    expect(r.franchiseLabel).toBe('TATA');
    expect(r.franchiseSeqId).toBe('2');
  });

  it('returns null labels for a numbers-only row (old parser / unlabeled)', () => {
    expect(mapFranchiseServiceDepartmentRow({ FranchiseSeqID: '1', SDNumber: '3' })).toEqual({
      franchiseSeqId: '1',
      sdNumber: '3',
      franchiseLabel: null,
      serviceDeptLabel: null,
    });
  });

  it('normalises blank / whitespace-only names to null', () => {
    expect(
      mapFranchiseServiceDepartmentRow({ Franshise: '   ', FranchiseSeqID: '5', SDName: '', SDNumber: '7' }),
    ).toEqual({
      franchiseSeqId: '5',
      sdNumber: '7',
      franchiseLabel: null,
      serviceDeptLabel: null,
    });
  });

  it('trims surrounding whitespace on numbers and labels', () => {
    expect(
      mapFranchiseServiceDepartmentRow({
        Franshise: '  FAW  ',
        FranchiseSeqID: ' 4 ',
        SDName: '  Service - FAW  ',
        SDNumber: ' 2 ',
      }),
    ).toEqual({
      franchiseSeqId: '4',
      sdNumber: '2',
      franchiseLabel: 'FAW',
      serviceDeptLabel: 'Service - FAW',
    });
  });
});
