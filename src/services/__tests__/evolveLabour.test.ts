import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import {
  formatHours,
  buildLabourLinesFromItems,
  renderRoJobDetailsXml,
  LabourItemRow,
} from '../evolveLabour';

// Convenience to build an item row with sensible defaults.
// Every required field of LabourItemRow must be present in the base literal:
// spreading a Partial<> over it makes any field it omits optional, which no
// longer satisfies the interface.
const row = (over: Partial<LabourItemRow>): LabourItemRow => ({
  id: 'i1',
  desc: 'Job',
  hoursWorked: '1.00',
  hoursSold: '1.00',
  estimatedHours: null,
  jobGroup: null,
  evolveLineNumber: null,
  evolveTechnicianNo: 6,
  ...over,
});

describe('formatHours', () => {
  it('formats decimals with a "." and two places (locale-independent)', () => {
    expect(formatHours('0.25')).toBe('0.25');
    expect(formatHours(1.5)).toBe('1.50');
    expect(formatHours('2')).toBe('2.00');
    expect(formatHours(0)).toBe('0.00');
  });

  it('returns null for missing/invalid/negative values', () => {
    expect(formatHours(null)).toBeNull();
    expect(formatHours(undefined as unknown as null)).toBeNull();
    expect(formatHours('')).toBeNull();
    expect(formatHours('abc')).toBeNull();
    expect(formatHours(-1)).toBeNull();
  });
});

describe('buildLabourLinesFromItems', () => {
  it('maps an assigned, mapped, hours-complete item to one N line', () => {
    const { lines, unresolved } = buildLabourLinesFromItems([
      row({ id: 'a', evolveTechnicianNo: 6, hoursWorked: '0.25', hoursSold: '0.50', desc: 'Service' }),
    ]);
    expect(unresolved).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      itemId: 'a',
      lineNumber: '01',
      jobNumber: '01',
      lineStatus: 'N',
      techNo: 6,
      hoursWorked: '0.25',
      hoursSold: '0.50',
      details: 'Service',
    });
  });

  it('flags an unmapped technician as TECH_UNMAPPED (never emits a blank TechNo)', () => {
    const { lines, unresolved } = buildLabourLinesFromItems([
      row({ id: 'a', evolveTechnicianNo: null }),
    ]);
    expect(lines).toEqual([]);
    expect(unresolved).toEqual([{ itemId: 'a', reason: 'TECH_UNMAPPED' }]);
  });

  it('flags missing hours as HOURS_MISSING', () => {
    const { lines, unresolved } = buildLabourLinesFromItems([
      row({ id: 'a', hoursWorked: null }),
      row({ id: 'b', hoursSold: '' }),
    ]);
    expect(lines).toEqual([]);
    expect(unresolved).toEqual([
      { itemId: 'a', reason: 'HOURS_MISSING' },
      { itemId: 'b', reason: 'HOURS_MISSING' },
    ]);
  });

  it('reuses a persisted line number as an U (update) line', () => {
    const { lines } = buildLabourLinesFromItems([
      row({ id: 'a', evolveLineNumber: 3 }),
    ]);
    expect(lines[0].lineNumber).toBe('03');
    expect(lines[0].lineStatus).toBe('U');
  });

  it('assigns sequential numbers to new lines and does not consume a number for unresolved rows', () => {
    const { lines, unresolved } = buildLabourLinesFromItems([
      row({ id: 'a', evolveTechnicianNo: 6 }),            // → 01 N
      row({ id: 'b', evolveTechnicianNo: null }),         // unresolved (no number consumed)
      row({ id: 'c', evolveTechnicianNo: 7 }),            // → 02 N
    ]);
    expect(unresolved).toEqual([{ itemId: 'b', reason: 'TECH_UNMAPPED' }]);
    expect(lines.map((l) => [l.itemId, l.lineNumber, l.lineStatus])).toEqual([
      ['a', '01', 'N'],
      ['c', '02', 'N'],
    ]);
  });

  it('mixes reused and new line numbers correctly', () => {
    const { lines } = buildLabourLinesFromItems([
      row({ id: 'a', evolveLineNumber: 5 }),  // reused → 05 U
      row({ id: 'b', evolveLineNumber: null }), // new → 01 N
    ]);
    expect(lines.map((l) => [l.lineNumber, l.lineStatus])).toEqual([
      ['05', 'U'],
      ['01', 'N'],
    ]);
  });
});

describe('renderRoJobDetailsXml', () => {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

  it('returns an empty string for no lines', () => {
    expect(renderRoJobDetailsXml([])).toBe('');
  });

  it('emits well-formed ROJobDetails with PostingType=L and the line fields', () => {
    const xml =
      '<Root>' +
      renderRoJobDetailsXml([
        { lineNumber: '01', jobNumber: '01', lineStatus: 'N', techNo: 6, hoursWorked: '0.25', hoursSold: '0.25', details: 'Svc' },
        { lineNumber: '03', jobNumber: '01', lineStatus: 'U', techNo: 33, hoursWorked: '1.50', hoursSold: '2.00', details: 'Brakes' },
      ]) +
      '</Root>';
    const parsed = parser.parse(xml);
    const details = parsed.Root.ROJobDetails;
    expect(Array.isArray(details)).toBe(true);
    expect(details).toHaveLength(2);
    expect(details[0].RowDetails).toMatchObject({
      LineNumber: 1,
      JobNumber: 1,
      LineStatus: 'N',
      PostingType: 'L',
      TechNo: 6,
    });
    expect(details[1].RowDetails.LineStatus).toBe('U');
    expect(details[1].RowDetails.TechNo).toBe(33);
  });

  it('escapes XML-special characters in details', () => {
    const xml = renderRoJobDetailsXml([
      { lineNumber: '01', jobNumber: '01', lineStatus: 'N', techNo: 6, hoursWorked: '1.00', hoursSold: '1.00', details: 'A & B <x>' },
    ]);
    expect(xml).toContain('A &amp; B &lt;x&gt;');
    expect(xml).not.toContain('A & B <x>');
  });
});
