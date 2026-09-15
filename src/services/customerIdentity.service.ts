/**
 * CustomerIdentity — the SINGLE authority for resolving a customer's Evolve
 * identity (CustSequenceID) for OUTBOUND, company-scoped operations.
 *
 * Per ADR-002, outbound identity resolution priority is:
 *     customer_company_links.cust_sequence_id   (authoritative PER company)
 *       → customers.cust_sequence_id            (legacy / primary fallback)
 *       → null
 *
 * After D2-1, no other service reads customer_company_links.cust_sequence_id
 * directly — everything goes through resolveCustomerEvolveId(). Company
 * resolution still belongs to CompanyResolver; this module resolves the CUSTOMER
 * identity only. It never writes and never calls Evolve.
 *
 * NB: `customers.cust_sequence_id` remains authoritative for inbound import,
 * deduplication, placeholder detection, and existing local lookups — those must
 * NOT use this resolver.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { customers, customerCompanyLinks } from '../db/models';

// Canonical placeholder test for a local (not-yet-Evolve) CustSequenceID: empty,
// a v4 UUID (appointment/walk-in default), or LOCAL_-prefixed. Exported so the
// customer/RO sync services share ONE definition (they drop their local copies
// in D2-2 / D2-3).
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isPlaceholderSeq(seq: string | null | undefined): boolean {
  if (!seq) return true;
  return UUID_REGEX.test(seq) || seq.startsWith('LOCAL_');
}

export type CustomerEvolveIdSource = 'link' | 'global' | 'none';

export interface ResolvedCustomerEvolveId {
  custSequenceId: string | null;
  source: CustomerEvolveIdSource;
}

/**
 * Resolve the Evolve CustSequenceID to use for an outbound, company-scoped
 * operation. Prefers the per-company link id; falls back to the legacy global
 * id; else none. A placeholder value (see isPlaceholderSeq) is treated as "not a
 * real Evolve id" at each level. Never throws.
 */
export async function resolveCustomerEvolveId(
  customerId: string,
  companyId?: string | null,
): Promise<ResolvedCustomerEvolveId> {
  // 1) Authoritative per-company identity (only when a company is in play).
  if (companyId) {
    const [link] = await db
      .select({ custSequenceId: customerCompanyLinks.custSequenceId })
      .from(customerCompanyLinks)
      .where(
        and(
          eq(customerCompanyLinks.customerId, customerId),
          eq(customerCompanyLinks.companyId, companyId),
        ),
      )
      .limit(1);
    if (link?.custSequenceId && !isPlaceholderSeq(link.custSequenceId)) {
      return { custSequenceId: link.custSequenceId, source: 'link' };
    }
  }

  // 2) Legacy / primary global fallback.
  const [cust] = await db
    .select({ custSequenceId: customers.custSequenceId })
    .from(customers)
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
    .limit(1);
  if (cust?.custSequenceId && !isPlaceholderSeq(cust.custSequenceId)) {
    return { custSequenceId: cust.custSequenceId, source: 'global' };
  }

  // 3) Nothing real resolvable.
  return { custSequenceId: null, source: 'none' };
}
