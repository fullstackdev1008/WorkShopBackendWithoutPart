import { describe, it, expect } from 'vitest';
import { renderRoJobHeaderRows, type RoJobHeaderJob } from '../evolveIrm.service';

// Unit tests for the multi-job <ROJobHeader> rendering (separate RowDetails per
// job). Pure string rendering — no DB, no network.
describe('renderRoJobHeaderRows', () => {
  it('renders one <RowDetails> per job with sequential JobNumbers', () => {
    const jobs: RoJobHeaderJob[] = [
      { jobNumber: '01', serviceType: 'S06', valueCpaEstimate: '100.00', customerStates: 'AIR FILTER', saInstruction: 'AIR FILTER' },
      { jobNumber: '02', serviceType: 'S06', valueCpaEstimate: '50.00', customerStates: 'SEAL OIL', saInstruction: 'SEAL OIL' },
    ];
    const xml = renderRoJobHeaderRows(jobs);

    // Exactly one wrapping <ROJobHeader> …
    expect(xml.match(/<ROJobHeader>/g)?.length).toBe(1);
    expect(xml.match(/<\/ROJobHeader>/g)?.length).toBe(1);
    // … containing two <RowDetails> (one per job).
    expect(xml.match(/<RowDetails>/g)?.length).toBe(2);
    expect(xml).toContain('<JobNumber>01</JobNumber>');
    expect(xml).toContain('<JobNumber>02</JobNumber>');
    // Each job carries only its OWN description (no cross-job merge).
    expect(xml).toContain('<CustomerStates>AIR FILTER</CustomerStates>');
    expect(xml).toContain('<CustomerStates>SEAL OIL</CustomerStates>');
    expect(xml).toContain('<JobAction>W</JobAction>');
  });

  it('applies the INT/S06/0 defaults when a job omits them', () => {
    const xml = renderRoJobHeaderRows([{ jobNumber: '01', customerStates: 'X', saInstruction: 'X' }]);
    expect(xml).toContain('<JobType>INT</JobType>');
    expect(xml).toContain('<ServiceType>S06</ServiceType>');
    expect(xml).toContain('<ValueCPAEstimate>0</ValueCPAEstimate>');
  });

  it('escapes XML-special characters in job text', () => {
    const xml = renderRoJobHeaderRows([{ jobNumber: '01', customerStates: 'A & B < C', saInstruction: 'A & B < C' }]);
    expect(xml).toContain('A &amp; B &lt; C');
    expect(xml).not.toContain('A & B < C');
  });

  it('keeps a duplicate description in DIFFERENT jobs (the multi-job fix)', () => {
    // The reported bug: a part present in job 1 and job 2 appeared twice merged
    // into one block. With per-job blocks it appears once in each job instead.
    const jobs: RoJobHeaderJob[] = [
      { jobNumber: '01', customerStates: 'AIR FILTER; SEAL OIL', saInstruction: 'AIR FILTER; SEAL OIL' },
      { jobNumber: '02', customerStates: 'SEAL OIL', saInstruction: 'SEAL OIL' },
    ];
    const xml = renderRoJobHeaderRows(jobs);
    expect(xml).toContain('<CustomerStates>AIR FILTER; SEAL OIL</CustomerStates>');
    expect(xml).toContain('<CustomerStates>SEAL OIL</CustomerStates>');
    // Two distinct job blocks, not one merged block with a repeated token.
    expect(xml.match(/<RowDetails>/g)?.length).toBe(2);
  });
});
