import { describe, it, expect } from 'vitest';
import { parseActiveTechniciansFromRows } from '../evolveTechnician';

// Rows shaped exactly like the extracted <RowDetails> of the real Evolve
// IRM_GetLookupDropdownTables (Technicians) response.
const sampleRows = [
  { TechnicianNo: '2', TechActiveEmployee: 'no', TechName: 'Can Use', TechLastName: 'CAN USE', TechIDNumber: '' },
  { TechnicianNo: '6', TechActiveEmployee: 'yes', TechName: 'Morne', TechLastName: 'Senekal', TechIDNumber: '7502015014085' },
  { TechnicianNo: '33', TechActiveEmployee: 'yes', TechName: 'Diedricks', TechLastName: 'Gouws', TechIDNumber: '8009115011085' },
  { TechnicianNo: '40', TechActiveEmployee: 'no', TechName: 'Do Not Use', TechLastName: 'DO NOT USE', TechIDNumber: '' },
];

describe('parseActiveTechniciansFromRows', () => {
  it('returns only active (TechActiveEmployee=yes) technicians', () => {
    const result = parseActiveTechniciansFromRows(sampleRows);
    expect(result.map((t) => t.technicianNo)).toEqual([6, 33]);
  });

  it('builds displayName from first + last name and coerces technicianNo to a number', () => {
    const [first] = parseActiveTechniciansFromRows(sampleRows);
    expect(first).toEqual({
      technicianNo: 6,
      firstName: 'Morne',
      lastName: 'Senekal',
      displayName: 'Morne Senekal',
    });
    expect(typeof first.technicianNo).toBe('number');
  });

  it('never surfaces PII (TechIDNumber is dropped)', () => {
    for (const t of parseActiveTechniciansFromRows(sampleRows)) {
      expect(Object.keys(t)).toEqual(['technicianNo', 'firstName', 'lastName', 'displayName']);
      expect(JSON.stringify(t)).not.toContain('TechIDNumber');
    }
  });

  it('drops rows with a missing or non-numeric TechnicianNo', () => {
    const rows = [
      { TechnicianNo: '', TechActiveEmployee: 'yes', TechName: 'Bad', TechLastName: 'Row' },
      { TechnicianNo: 'abc', TechActiveEmployee: 'yes', TechName: 'Worse', TechLastName: 'Row' },
      { TechnicianNo: '0', TechActiveEmployee: 'yes', TechName: 'Zero', TechLastName: 'Row' },
      { TechnicianNo: '118081', TechActiveEmployee: 'yes', TechName: 'Big', TechLastName: 'Number' },
    ];
    const result = parseActiveTechniciansFromRows(rows);
    expect(result.map((t) => t.technicianNo)).toEqual([118081]);
  });

  it('handles an empty list', () => {
    expect(parseActiveTechniciansFromRows([])).toEqual([]);
  });
});
