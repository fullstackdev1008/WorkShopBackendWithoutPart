import { describe, it, expect } from 'vitest';
import { parseActiveServiceAdvisorsFromRows } from '../evolveServiceAdvisor';

// Rows modelled on the real Evolve ServiceAdvisors lookup response.
const rows = [
  { SANumber: '2', SAActiveEmployee: 'no', SAName: 'DO NOT USE', SALastName: 'DO NOT USE' },
  { SANumber: '4', SAActiveEmployee: 'yes', SAName: 'IVECO', SALastName: '0' },
  { SANumber: '24', SAActiveEmployee: 'yes', SAName: 'ALEZIA', SALastName: 'VERMEULEN' },
  { SANumber: '48', SAActiveEmployee: 'YES', SAName: 'FERAAZ', SALastName: 'KHAN' },
  { SANumber: '', SAActiveEmployee: 'yes', SAName: 'BROKEN', SALastName: 'ROW' },
  { SANumber: 'abc', SAActiveEmployee: 'yes', SAName: 'BAD', SALastName: 'NUM' },
];

describe('parseActiveServiceAdvisorsFromRows', () => {
  it('keeps only active advisors with a valid positive SANumber', () => {
    const out = parseActiveServiceAdvisorsFromRows(rows);
    expect(out.map((s) => s.saNumber)).toEqual([4, 24, 48]);
  });

  it('drops inactive ("no") advisors', () => {
    const out = parseActiveServiceAdvisorsFromRows(rows);
    expect(out.find((s) => s.saNumber === 2)).toBeUndefined();
  });

  it('treats a "0" last name as blank in the display name', () => {
    const out = parseActiveServiceAdvisorsFromRows(rows);
    const iveco = out.find((s) => s.saNumber === 4);
    expect(iveco?.displayName).toBe('IVECO');
  });

  it('builds "First Last" display names', () => {
    const out = parseActiveServiceAdvisorsFromRows(rows);
    expect(out.find((s) => s.saNumber === 24)?.displayName).toBe('ALEZIA VERMEULEN');
  });

  it('is case-insensitive on the active flag', () => {
    const out = parseActiveServiceAdvisorsFromRows(rows);
    expect(out.find((s) => s.saNumber === 48)).toBeTruthy();
  });

  it('drops rows with missing/non-numeric SANumber', () => {
    const out = parseActiveServiceAdvisorsFromRows(rows);
    expect(out.some((s) => s.firstName === 'BROKEN' || s.firstName === 'BAD')).toBe(false);
  });
});
