import { describe, it, expect } from 'vitest';
import { matchModelCode, normalise, FUZZY_THRESHOLD, ModelCodeRow } from '../modelCodeMatcher';

describe('normalise', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalise('1.5 TREND (5DR)')).toBe('15TREND5DR');
    expect(normalise('J6 500')).toBe('J6500');
    expect(normalise('  figo 1.5  trend ')).toBe('FIGO15TREND');
  });
  it('handles null/undefined/empty', () => {
    expect(normalise(null)).toBe('');
    expect(normalise(undefined)).toBe('');
    expect(normalise('')).toBe('');
  });
});

describe('matchModelCode — HIGH', () => {
  it('exact single distinct code → HIGH', () => {
    const rows: ModelCodeRow[] = [
      { code: 'KFNE', description: 'Figo 1.5 trend 82kw 5mt', modelYear: 2016 },
      { code: '22020320', description: '1.5 TREND', modelYear: 2018 },
    ];
    const r = matchModelCode('1.5 TREND', rows);
    expect(r.confidence).toBe('HIGH');
    expect(r.code).toBe('22020320');
  });

  it('same code repeated across many model years → still HIGH', () => {
    const rows: ModelCodeRow[] = [2015, 2016, 2017, 2018, 2019, 2020].map((y) => ({
      code: '22020100',
      description: '1.4 AMBIENTE',
      modelYear: y,
    }));
    const r = matchModelCode('1.4 Ambiente', rows);
    expect(r.confidence).toBe('HIGH');
    expect(r.code).toBe('22020100');
  });
});

describe('matchModelCode — AMBIGUOUS (no year tie-break, no first-code guess)', () => {
  it('exact description maps to >1 distinct code → AMBIGUOUS (code null)', () => {
    const rows: ModelCodeRow[] = [
      { code: 'AAA', description: '1.5 TREND', modelYear: 2019 },
      { code: 'BBB', description: '1.5 TREND', modelYear: 2021 },
    ];
    const r = matchModelCode('1.5 trend', rows);
    expect(r.confidence).toBe('AMBIGUOUS');
    expect(r.code).toBeNull();
    expect(r.candidates).toEqual(expect.arrayContaining(['AAA', 'BBB']));
  });

  it('does NOT use modelYear to break a tie even when vehicle year would match', () => {
    // Two codes, same exact description, different years. The matcher must not
    // auto-pick by year — registration_year ≠ model_year.
    const rows: ModelCodeRow[] = [
      { code: 'AAA', description: 'J6 500', modelYear: 2019 },
      { code: 'BBB', description: 'J6 500', modelYear: 2024 },
    ];
    const r = matchModelCode('J6 500', rows);
    expect(r.confidence).toBe('AMBIGUOUS');
    expect(r.code).toBeNull();
  });

  it('normalization collision across distinct codes → AMBIGUOUS, never wrong HIGH', () => {
    const rows: ModelCodeRow[] = [
      { code: 'X1', description: '1.5 TREND', modelYear: 2018 },  // → 15TREND
      { code: 'X2', description: '1 5 TREND', modelYear: 2018 },  // → 15TREND (collision)
    ];
    const r = matchModelCode('1.5 trend', rows);
    expect(r.confidence).toBe('AMBIGUOUS');
    expect(r.code).toBeNull();
  });
});

describe('matchModelCode — MEDIUM / LOW (fuzzy, suggestion only)', () => {
  it('single dominant fuzzy candidate above threshold → MEDIUM', () => {
    const rows: ModelCodeRow[] = [
      { code: 'TIT', description: '1.5 TITANIUM POWERSHIFT (5DR)', modelYear: 2018 },
      { code: 'AMB', description: '1.4 AMBIENTE', modelYear: 2012 },
    ];
    // Heavy token overlap with the TITANIUM row, weak with AMBIENTE.
    const r = matchModelCode('1.5 TITANIUM POWERSHIFT', rows);
    expect(r.confidence).toBe('MEDIUM');
    expect(r.code).toBe('TIT');
  });

  it('weak overlap, no dominant candidate → LOW (code null)', () => {
    const rows: ModelCodeRow[] = [
      { code: 'AAA', description: '1.4 AMBIENTE', modelYear: 2012 },
      { code: 'BBB', description: '1.4 TREND', modelYear: 2013 },
    ];
    const r = matchModelCode('1.4 GHIA EXTREME LIMITED', rows);
    expect(['LOW', 'UNRESOLVED']).toContain(r.confidence);
    expect(r.code).toBeNull();
  });
});

describe('matchModelCode — UNRESOLVED (fail-closed)', () => {
  it('empty catalog → UNRESOLVED', () => {
    const r = matchModelCode('J6 500', []);
    expect(r.confidence).toBe('UNRESOLVED');
    expect(r.code).toBeNull();
  });

  it('blank model → UNRESOLVED', () => {
    const r = matchModelCode('', [{ code: 'X', description: 'whatever', modelYear: 2020 }]);
    expect(r.confidence).toBe('UNRESOLVED');
  });

  it('FAW "J6 500" against unrelated FORD catalog → UNRESOLVED (never a guess)', () => {
    const rows: ModelCodeRow[] = [
      { code: 'KFNE', description: 'Figo 1.5 trend 82kw 5mt', modelYear: 2016 },
      { code: '22020100', description: '1.4 AMBIENTE', modelYear: 2016 },
      { code: '22020270', description: '1.5 TITANIUM (5DR)', modelYear: 2018 },
    ];
    const r = matchModelCode('J6 500', rows);
    expect(r.code).toBeNull();
    expect(['UNRESOLVED', 'LOW']).toContain(r.confidence);
  });

  it('rows with blank codes are ignored → UNRESOLVED', () => {
    const rows: ModelCodeRow[] = [
      { code: '', description: 'J6 500', modelYear: 2020 },
      { code: '   ', description: 'J6 500', modelYear: 2021 },
    ];
    const r = matchModelCode('J6 500', rows);
    expect(r.confidence).toBe('UNRESOLVED');
    expect(r.code).toBeNull();
  });
});

describe('threshold sanity', () => {
  it('FUZZY_THRESHOLD is a fraction in (0,1]', () => {
    expect(FUZZY_THRESHOLD).toBeGreaterThan(0);
    expect(FUZZY_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
