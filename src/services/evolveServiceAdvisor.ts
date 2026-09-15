/**
 * Pure (dependency-free) parsing for Evolve service advisors. Kept free of env/
 * db/network imports so it is unit-testable in isolation (see
 * __tests__/evolveServiceAdvisor.test.ts). The I/O wrapper (fetch + XML extract)
 * lives in masterDataSync.service.ts. Mirrors evolveTechnician.ts.
 */

// A single active Evolve service advisor, as surfaced to the admin mapping UI.
// `saNumber` is written to users.evolve_sa_number and later emitted as the RO
// <ServiceAdvisorNumber>. NOTE: SAIDNumber (a South African ID number = PII) is
// intentionally NOT surfaced or stored — only SANumber + name are needed to map.
export interface EvolveServiceAdvisor {
  saNumber: number;
  firstName: string;
  lastName: string;
  displayName: string;
}

// Given the extracted <RowDetails> rows of the ServiceAdvisors lookup table,
// return only ACTIVE advisors (SAActiveEmployee=yes), dropping PII and any
// malformed row with a missing/non-numeric/non-positive SANumber. The dropdown
// is full of inactive "DO NOT USE" placeholders that must never be mapped.
// Evolve uses the literal "0" as an empty last name (e.g. brand-desk rows like
// "IVECO 0" / "FAW 0"), so a "0" last name is treated as blank.
export function parseActiveServiceAdvisorsFromRows(
  rows: Array<Record<string, string>>,
): EvolveServiceAdvisor[] {
  return rows
    .filter((r) => (r.SAActiveEmployee ?? '').trim().toLowerCase() === 'yes')
    .map((r) => {
      const saNumber = Number((r.SANumber ?? '').trim());
      const firstName = (r.SAName ?? '').trim();
      const lastNameRaw = (r.SALastName ?? '').trim();
      const lastName = lastNameRaw === '0' ? '' : lastNameRaw;
      const displayName = `${firstName} ${lastName}`.trim();
      return { saNumber, firstName, lastName, displayName };
    })
    .filter((s) => Number.isInteger(s.saNumber) && s.saNumber > 0);
}
