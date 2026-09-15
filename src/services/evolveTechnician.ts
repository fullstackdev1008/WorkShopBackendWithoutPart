/**
 * Pure (dependency-free) parsing for Evolve technicians. Kept free of env/db/
 * network imports so it is unit-testable in isolation (see
 * __tests__/evolveTechnician.test.ts). The I/O wrapper (fetch + XML extract)
 * lives in masterDataSync.service.ts.
 */

// A single active Evolve technician, as surfaced to the admin mapping UI.
// `technicianNo` is written to users.evolve_technician_no and later emitted as
// <TechNo>. NOTE: TechIDNumber (a South African ID number = PII) is intentionally
// NOT surfaced or stored — only TechnicianNo + name are needed to map.
export interface EvolveTechnician {
  technicianNo: number;
  firstName: string;
  lastName: string;
  displayName: string;
}

// Given the extracted <RowDetails> rows of the Technicians table, return only
// ACTIVE technicians (TechActiveEmployee=yes), dropping PII and any malformed
// row with a missing/non-numeric/non-positive TechnicianNo. The dropdown
// contains many inactive "Can Use" / "Do Not Use" placeholders that must never
// be mapped.
export function parseActiveTechniciansFromRows(
  rows: Array<Record<string, string>>,
): EvolveTechnician[] {
  return rows
    .filter((r) => (r.TechActiveEmployee ?? '').trim().toLowerCase() === 'yes')
    .map((r) => {
      const technicianNo = Number((r.TechnicianNo ?? '').trim());
      const firstName = (r.TechName ?? '').trim();
      const lastName = (r.TechLastName ?? '').trim();
      const displayName = `${firstName} ${lastName}`.trim();
      return { technicianNo, firstName, lastName, displayName };
    })
    .filter((t) => Number.isInteger(t.technicianNo) && t.technicianNo > 0);
}
