# ADR-002 — Customer Identity Model (Multi-Company)

**Status:** Proposed (blocks Phase D2)
**Related:** ADR-001 (multi-company appointment architecture; persistence model frozen in Appendix C)
**Scope:** How a local customer maps to Evolve customer identities across multiple companies (10EC, 20EC, …).

## Problem
Each Evolve company is a separate tenant addressed by its own `InterfaceCode`, and a person who is a customer in two companies has a **different `CustSequenceID` in each**. Our local model has a single `customers.cust_sequence_id` (NOT NULL, unique with CRM ref), and the two **outbound** Evolve paths key off it globally:
- `customerEvolveSync` "already-synced" guard uses `customers.custSequenceId` → once a customer is synced to company A, it is **never** created in company B (Scenario 3 broken).
- `jobCardEvolveSync` sends `customers.custSequenceId` as the RO `OwnerCustSequenceID` → a company-B RO can carry the customer's **company-A** id (wrong-tenant owner).

A single column cannot represent per-company identities.

## Current model
- `customers.cust_sequence_id` — the one Evolve id. Roles: outbound identity (customer push guard + RO owner), import/upsert key (`evolveCustomerPersist`, `createCustomer`), local dedup (unique index), reconcile placeholder signal.
- `customer_company_links.cust_sequence_id` (from ADR-001 Phase B3/C5) — exists and is enriched on customer push, but **not consulted** by the outbound guards.

## Proposed model
- **`customer_company_links.cust_sequence_id` is the authoritative Evolve identity *per company*** and is used for all **company-scoped outbound** operations.
- **`customers.cust_sequence_id` is retained** as: the **primary/first-known** Evolve id, the **local dedup/upsert key** for inbound imports, and the **reconcile placeholder** signal. It is no longer the authority for per-company outbound.
- **Outbound resolution priority** (company-scoped):
  ```
  customer_company_links(company).cust_sequence_id
    → (fallback) customers.cust_sequence_id      // legacy / single-company
    → Evolve
  ```
- **Inbound / import / dedup / admin** paths are unchanged and keep using `customers.cust_sequence_id`.
- Scope of change — exactly two services:
  - `customerEvolveSync`: "already synced for THIS company" = the `(customer, company)` link has a `cust_sequence_id`; if not, push `CustomerMaintenance` to that company and store the returned id on the link (C5 already writes it).
  - `jobCardEvolveSync`: resolve the RO `OwnerCustSequenceID` from the `(customer, vehicle.owning_company_id)` link, falling back to `customers.cust_sequence_id`.
- All behind `EVOLVE_COMPANY_AWARE_PUSH`.

## Advantages
- Fixes Scenario 3 (same customer created in a second company) and the RO wrong-owner bug.
- **No schema change** — the link column already exists.
- **Incremental & flag-gated** — outbound only; inbound/dedup untouched.
- Single-company deployments are unaffected (link == global, or global fallback).
- Scales to N companies with no code change (links are data).

## Risks
- **RO owner regression** if the link is empty and no fallback → mitigated by the explicit `link → global` fallback; never send an empty owner id.
- **Guard divergence** — customer push guard must be per-company while the reconcile sweep still scans the global placeholder; acceptable because the sweep only *selects candidates* and `syncCustomerToEvolve` re-applies the authoritative per-company guard.
- **Dedup unaffected** — the unique constraint on `customers.cust_sequence_id` stays; imports still key on it.
- **Ambiguity of the global column** — it becomes "primary/first company"; documented, not removed.

## Migration strategy
1. Add a resolver `resolveCustomerEvolveId(customerId, companyId)` → link id, else global (single source of truth for outbound identity).
2. Switch `customerEvolveSync` guard/push/enrich to per-company via the link.
3. Switch `jobCardEvolveSync` RO owner resolution to the link (by vehicle owning company) with global fallback.
4. Gate all of it behind `EVOLVE_COMPANY_AWARE_PUSH`.
5. (Optional, later) Backfill `customer_company_links.cust_sequence_id` from `customers.cust_sequence_id` for existing single-company customers so their links are populated.

## Backward compatibility
- Flag OFF → outbound uses `customers.cust_sequence_id` exactly as today.
- Single-company / legacy → link absent → global fallback → identical behaviour.
- No API, DTO, or schema changes; inbound/import/dedup unchanged.

## Long-term architecture
- The `(customer, company)` link is the identity of record per company. Once all outbound paths resolve via links and all active customers have links (post-backfill), `customers.cust_sequence_id` is purely a legacy/primary convenience. Dropping its NOT NULL / unique constraint is a far-future, out-of-scope consideration — not required for correctness.
- Same pattern extends to any future per-company customer attribute (e.g. per-company CRM ref, already modelled on the link).
