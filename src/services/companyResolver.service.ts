/**
 * CompanyResolver — the SINGLE authority for translating a companyId into an
 * Evolve InterfaceCode, and the only place the backend reads the `companies`
 * table for resolution.
 *
 * Every company-aware flow (search, appointment create, customer sync, RO sync)
 * MUST depend on this resolver rather than querying `companies` directly, so the
 * mapping
 *      companyId → companies table → interface_code
 * lives in exactly one place.
 *
 * Responsibilities (intentionally narrow):
 *   • listActive()            — active companies for the UI selector (no interface_code)
 *   • getById(id)             — resolve a company by id (includes isActive)
 *   • resolveInterfaceCode(id)— active company's InterfaceCode, else null
 *
 * NOTE: This is Phase A. Nothing here changes Evolve calls or persistence yet —
 * it only exposes resolution. Interface codes are never returned to the client
 * (see the companies HTTP layer, which projects to PublicCompany).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { companies } from '../db/models';

// Safe, client-facing shape — never carries interface_code.
export interface PublicCompany {
  id: string;
  code: string;
  name: string;
}

// Full internal shape — interface_code stays server-side.
export interface ResolvedCompany extends PublicCompany {
  interfaceCode: string;
  isActive: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure decision: the InterfaceCode for a resolved company, or null when the
 * company is missing or inactive. Extracted so the "resolve + validate active"
 * rule is unit-testable without a DB. A null result maps to a 400 at the API.
 */
export function interfaceCodeFor(company: ResolvedCompany | null): string | null {
  if (!company || !company.isActive) return null;
  return company.interfaceCode;
}

/** Active companies, ordered by code — for the company selector dropdown. */
async function listActive(): Promise<PublicCompany[]> {
  return db
    .select({ id: companies.id, code: companies.code, name: companies.name })
    .from(companies)
    .where(eq(companies.isActive, true))
    .orderBy(companies.code);
}

/**
 * Resolve a company by id (regardless of active state). Returns null for a
 * missing/blank/non-UUID id — never throws on malformed input, so callers can
 * treat "unresolved" uniformly.
 */
async function getById(companyId: string | null | undefined): Promise<ResolvedCompany | null> {
  if (!companyId || !UUID_RE.test(companyId)) return null;
  const [row] = await db
    .select({
      id: companies.id,
      code: companies.code,
      name: companies.name,
      interfaceCode: companies.interfaceCode,
      isActive: companies.isActive,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a company by its InterfaceCode (reverse lookup). Supports the legacy
 * `interfaceCode` search param until it is retired; keeps all `companies` reads
 * inside this resolver. Returns null for a blank/unknown code.
 */
async function getByInterfaceCode(interfaceCode: string | null | undefined): Promise<ResolvedCompany | null> {
  if (!interfaceCode) return null;
  const [row] = await db
    .select({
      id: companies.id,
      code: companies.code,
      name: companies.name,
      interfaceCode: companies.interfaceCode,
      isActive: companies.isActive,
    })
    .from(companies)
    .where(eq(companies.interfaceCode, interfaceCode))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve the Evolve InterfaceCode for a company. Returns null when the company
 * is unknown OR inactive — i.e. "resolve + validate active" in one call. This
 * is the method company-aware Evolve flows will use in later phases.
 */
async function resolveInterfaceCode(companyId: string | null | undefined): Promise<string | null> {
  return interfaceCodeFor(await getById(companyId));
}

export const companyResolver = {
  listActive,
  getById,
  getByInterfaceCode,
  resolveInterfaceCode,
};
