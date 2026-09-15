# ADR-001 — Multi-Company Appointment Architecture

**Status:** Accepted (design frozen)
**Scope:** Evolve integration — customer/vehicle search, creation, and RO sync across multiple Evolve companies (10EC, 20EC, …).
**Applies to:** `WorkShopBackend` (Node/Fastify/Drizzle) and `TrueGear` (React/Vite).

---

## Purpose
Define the single, authoritative architecture for operating the appointment/job-card flow across multiple Evolve dealerships ("companies"), each addressed by its own Evolve `InterfaceCode`. This document is the implementation specification: every recommendation is grounded in the existing codebase and all changes are additive and backward compatible.

## Problem Statement
Each Evolve company is a separate tenant addressed by an `InterfaceCode` (e.g. `95112-AGLT-10EC`, `95112-AGLT-20EC`). Historically:
- The company chosen at search was local UI state only; it never reached customer/vehicle persistence or the Evolve pushes.
- On a company-scoped "not found," the app fell back to a **company-agnostic** local search, surfacing a vehicle from another company and letting users book under the **wrong company**.
- Customer (`IRM_CustomerMaintenance`) and RO (`IRM_ROMaintenance`) pushes always used the **default** `env.EVOLVE_INTERFACE_CODE`, not the selected company.

This ADR fixes the ownership model so data integrity and correct company attribution are guaranteed, and so adding companies never requires code changes.

---

## Business Rules
1. **Vehicle ownership is authoritative.** `vehicles.owning_company_id` is the source of truth for which company a vehicle belongs to.
2. **A VIN belongs to exactly one company.** Enforced logically; the local mirror holds a single `owning_company_id` per VIN.
3. **Customers may exist in multiple companies.** Modeled by `customer_company_links` (one row per company, each with that company's `cust_sequence_id`).
4. **Company selection is required when creating a new customer/vehicle.** No silent default for creation.
5. **Frontend never knows the InterfaceCode.** The FE handles only `companyId`. `GET /companies` never returns `interface_code`.
6. **Backend is the only component that resolves InterfaceCode.** Every request: `companyId → companies lookup → validate active → interface_code`.
7. **RO always follows vehicle ownership.** RO interface code resolves from `vehicles.owning_company_id`, never from the appointment (except NULL-fallback).
8. **Appointment company is a snapshot only.** `appointments.company_id` is for reporting and NULL-fallback; it never overrides vehicle ownership.
9. **Company change resets customer/vehicle selection.** Company defines the tenant; changing it invalidates prior identity resolution.
10. **Cross-company vehicle creation is blocked.** If a VIN belongs to another company, the create is blocked and a "switch company" prompt is offered.
11. **InterfaceCode is never persisted on business entities.** It lives only in `companies.interface_code` and is resolved at call time.
12. **Ownership only changes from an authoritative Evolve FOUND** (or explicit create), never from a local edit or appointment creation. FOUND under a new company reassigns ownership (last-authoritative-wins) and is logged.

---

## Database Design

### ERD (text)
```
companies
  id              uuid  PK
  code            varchar(20)  UNIQUE      -- '10EC','20EC'  (UI label)
  name            varchar(100)
  interface_code  varchar(50)  UNIQUE      -- '95112-AGLT-10EC'  (server-only)
  is_active       boolean
  created_at / updated_at

customers
  id              uuid  PK
  cust_sequence_id varchar                 -- legacy single-id (kept; per-company id lives in link)
  company_name / first_name / last_name / primary_email ...
  (no interface_code, no single company_id)

customer_company_links                     -- NEW (Phase B)
  id              uuid  PK
  customer_id     uuid  FK → customers.id
  company_id      uuid  FK → companies.id
  cust_sequence_id varchar                 -- Evolve CustSequenceID in THAT company
  crm_reference_no varchar
  UNIQUE (customer_id, company_id)

vehicles
  id                uuid PK
  vin               varchar  (unique per active row)
  customer_id       uuid FK → customers.id
  owning_company_id uuid FK → companies.id  -- AUTHORITATIVE ownership (exists: 0042)
  evolve_synced_at  timestamptz             -- cache provenance (exists: 0042)
  brand / model / model_code / registration_number / registration_year ...

appointments
  id            uuid PK
  vehicle_id    uuid FK → vehicles.id
  customer_id   uuid FK → customers.id
  company_id    uuid FK → companies.id       -- NEW (Phase B): SNAPSHOT / reporting only
  appointment_date / appointment_time / status ...
```

### Ownership relationships
- **companies 1 ── N vehicles** via `vehicles.owning_company_id` (authoritative; one company per VIN).
- **companies N ── N customers** via `customer_company_links` (a person can be a customer in several companies).
- **companies 1 ── N appointments** via `appointments.company_id` (snapshot of the booking context; not authoritative).
- **Rule:** for any Evolve RO, the company is read from the **vehicle**, never the appointment.

Existing columns reused: `companies`, `vehicles.owning_company_id`, `vehicles.evolve_synced_at` (migration `0042_company_ownership.sql`). New in Phase B: `appointments.company_id`, `customer_company_links`.

---

## API Contracts
All responses use the standard envelope `{ success, data, error }` (+ optional `meta` sibling via `successWithMeta`). All additions are backward compatible.

### GET /companies  (drives the dropdown)
Never exposes `interface_code`.
```jsonc
// response
{ "success": { "status": true, "code": 200, "message": "Companies fetched" },
  "data": [
    { "id": "c1-uuid", "code": "10EC", "name": "10EC" },
    { "id": "c2-uuid", "code": "20EC", "name": "20EC" }
  ],
  "error": null }
```

### GET /appointments/irm-search  (company-scoped search)
Request (query): `vin?`, `reg?`, `phone?`, and the company (today `interfaceCode`; target `companyId` — see Follow-up). `data` is always an array; the outcome travels in `meta`.
```jsonc
// FOUND
{ "success": {…}, "data": [ { "localCustomerId": "...", "custSequenceId": "...", "vehicle": {…} } ],
  "error": null, "meta": { "outcome": "FOUND", "company": "95112-AGLT-10EC", "source": "evolve" } }

// NOT_FOUND (authoritative — no local fallback for vehicle searches)
{ "success": {…}, "data": [], "error": null,
  "meta": { "outcome": "NOT_FOUND", "company": "95112-AGLT-10EC", "source": "evolve" } }

// UNAVAILABLE (Evolve failure — do not treat as "no record")
{ "success": {…}, "data": [], "error": null,
  "meta": { "outcome": "UNAVAILABLE", "company": "95112-AGLT-10EC", "source": "evolve" } }

// SWITCH_COMPANY (VIN owned by another company)
{ "success": {…}, "data": [], "error": null,
  "meta": { "outcome": "SWITCH_COMPANY", "company": "95112-AGLT-10EC", "source": "local",
            "ownedByCompany": { "code": "20EC", "interfaceCode": "95112-AGLT-20EC" } } }
```

### POST /appointments  (create customer + vehicle + appointment)
`companyId` is additive; required when `newCustomer`/`newVehicle` is present (enforced in Phase D).
```jsonc
// request
{ "companyId": "c1-uuid",
  "appointmentDate": "2026-07-10", "appointmentTime": "10:00",
  "newCustomer": { "companyName": "Acme Ltd", "contactNumber": "0116833364", "primaryEmail": "a@acme.co.za" },
  "newVehicle":  { "vin": "AAK1518FLSB081400", "brand": "MAHINDRA", "registrationNumber": "B081400", "manufacturingYear": 2023 } }

// response
{ "success": { "status": true, "code": 201, "message": "Appointment created" },
  "data": { "appointmentId": "...", "customerId": "...", "vehicleId": "...", "companyId": "c1-uuid" },
  "error": null }

// error — cross-company vehicle (Phase D)
{ "success": null, "data": null,
  "error": { "status": false, "code": 409, "message": "Vehicle belongs to company 20EC",
             "ownedByCompany": { "code": "20EC" } } }
```

---

## Company Resolution Rules (single authoritative chain)

**Create / customer flows** (server-side only):
```
companyId (from FE)
   → SELECT * FROM companies WHERE id = :companyId AND is_active = true
   → not found / inactive → reject (INVALID_COMPANY)
   → interface_code
   → use in the Evolve call
```

**RO sync** (vehicle-driven; appointment is fallback only):
```
vehicle.owning_company_id
   → (if NULL) appointment.company_id            -- snapshot fallback
   → (if still NULL) env.EVOLVE_INTERFACE_CODE    -- final safe fallback
   → companies.interface_code
   → IRM_ROMaintenance
```
There is no path where a *known* appointment company overrides a *known* vehicle ownership. `InterfaceCode` is produced only at call time and never returned to the client.

---

## Sequence Diagrams

**1. Existing customer search**
```
User→FE: company + VIN → FE→BE /irm-search(companyId,vin)
BE: resolve interface_code → Evolve IRM_Customer_VehicleLookup → classify
 FOUND→persist(owning_company_id)+return  | NOT_FOUND→probe(§7)  | UNAVAILABLE→"try again"
```

**2. New customer creation**
```
User: "Add New" (company already selected in wizard)
FE: POST /appointments { companyId, newCustomer, ... }
BE: resolve companyId→company; insert customer; add customer_company_links(company_id)
```

**3. New vehicle creation**
```
FE: POST /appointments { companyId, newVehicle, ... }
BE: cross-company guard (§7); if clear → insert vehicle with owning_company_id = company
```

**4. Appointment creation**
```
BE createAppointment (1 tx): [customer]→[vehicle owning_company_id]→[appointment company_id snapshot]
post-commit: syncCustomerToEvolve(customerId, companyId)
```

**5. Customer sync**
```
syncCustomerToEvolve(customerId, companyId)
 → resolve interface_code → IRM_CustomerMaintenance(InterfaceCode) → store returned CustSequenceID in link
```

**6. RO sync**
```
syncJobCardToEvolveRo(jobCardId) → load job card + vehicle
 → interface_code = resolve(vehicle.owning_company_id → appointment.company_id → env)
 → IRM_ROMaintenance(InterfaceCode)  → Evolve creates/updates service history under that company
```

**7. Cross-company detection**
```
NOT_FOUND (vehicle search) → findVehicleOwnerElsewhere(vin/reg, exclude selected)
 owned by C' → return SWITCH_COMPANY(C') → FE prompts "switch to C'?" → re-search under C'
 owned by none → NEW (allow Add New under selected company)
```

---

## Validation Rules
- `companyId` is **required** when `newCustomer` or `newVehicle` is present; missing → 400.
- `companyId` must exist in `companies` and `is_active = true`; else `INVALID_COMPANY` (400).
- FE must send `companyId` only; a raw `interface_code` from the client is never trusted in create flows.
- VIN uniqueness: one active vehicle per VIN; creating a VIN owned by another company → blocked (409, `SWITCH_COMPANY`).
- Customer identity: reuse existing customer by `cust_sequence_id`/email/phone; a second company → add a `customer_company_links` row, never clone.
- Company change in the wizard clears selected/searched customer + vehicle.
- Vehicle searches never fall back to company-agnostic local data on `NOT_FOUND`/`UNAVAILABLE`.
- Ownership is written only on authoritative FOUND or explicit create; transfers (FOUND under a new company) are logged.

## Error Handling

| Signal | Meaning | Behaviour |
|---|---|---|
| `FOUND` | Evolve returned a record for the company | show results; persist + stamp ownership |
| `NOT_FOUND` | Evolve authoritatively has no record for the company | vehicle search: "not found in {company}", **no** local fallback; identity search: local fallback allowed |
| `UNAVAILABLE` | Evolve failed (timeout/5xx/transport) | "try again"; **no** local fallback for vehicle search; never treated as "no record" |
| `SWITCH_COMPANY` | VIN owned by another company | prompt "belongs to {code} — switch & search"; one-click re-search under owner |
| `INVALID_COMPANY` | `companyId` missing/unknown/inactive | 400; block create/search |

## Rollback Strategy
- All changes additive and backward compatible: response `data` stays an array, HTTP 200 for search outcomes, `meta`/`companyId` optional, new DB columns/tables nullable.
- **Code rollback:** redeploy the previous build; no coordinated FE/BE step required (older clients ignore `meta`/`companyId`).
- **Push rollback:** the RO/customer interface-code resolution ends in `env.EVOLVE_INTERFACE_CODE`, so an unresolved company degrades to legacy behaviour rather than failing.
- **DB rollback:** new columns/table are inert if code is reverted; drop later if desired (`appointments.company_id`, `customer_company_links`; keep `companies`/`vehicles.owning_company_id`).

## Feature Flags
- `EVOLVE_COMPANY_AWARE_PUSH` (new, default off): gates Phase C — when off, customer/RO pushes use the current `env` default (today's behaviour); when on, they resolve per-company. Lets Phases A/B (data capture) ship before switching Evolve targeting.
- `EVOLVE_ENFORCE_COMPANY_ON_CREATE` (new, default off): gates Phase D — makes `companyId` required and enables the cross-company create guard.
- Reuse existing gates unchanged: `EVOLVE_JOB_CARD_SYNC_ENABLED`, `EVOLVE_MODELCODE_MODE`, `EVOLVE_CATALOG_WARM_ENABLED`.

## Testing Matrix

**Unit**
- Company resolver: valid/inactive/unknown `companyId`.
- RO resolution chain: vehicle owner → appointment fallback → env fallback.
- Search outcome classifier: FOUND/NOT_FOUND/UNAVAILABLE.
- Cross-company probe: owned-elsewhere vs owned-none.

**Integration**
- `POST /appointments` with `companyId` sets vehicle ownership, appointment snapshot, customer link.
- `syncCustomerToEvolve` uses per-company interface code (flag on).
- `syncJobCardToEvolveRo` pushes under vehicle ownership; transfer follows the vehicle.
- `GET /companies` never returns `interface_code`.

**Regression**
- Identity (phone) search still falls back to local.
- Legacy request without `companyId` behaves as today (flags off).
- Existing customer refresh (`customers/service.ts`) unaffected (no company passed).

**UAT**
- Create under 10EC → customer + RO land in 10EC; under 20EC → 20EC.
- Same VIN searched under the wrong company → switch prompt → correct company after switch.
- Unknown VIN → "not found in {company}", no wrong-company match.
- Transferred vehicle → next RO follows the new owning company.

## Future Scalability (10+ companies, no code changes)
- Companies are **data**, not code: add a row to `companies` (`code`, `name`, `interface_code`) and it appears in `GET /companies` → the dropdown, the resolver, and ownership all work immediately.
- The hardcoded `ALLOWED_INTERFACE_CODES` set and FE `COMPANY_OPTIONS` are replaced by the registry (see Follow-up), removing the last per-company code.
- Search targets exactly one company (selected) plus a local ownership index for detection — no O(N) fan-out across companies, so cost is independent of company count.
- `InterfaceCode` never appears in the FE, payloads, or business rows — only in the `companies` row — so onboarding a company is a single INSERT.

## Follow-up (recommended, non-blocking)
Migrate the **search** flow to send `companyId` (like create) and retire `ALLOWED_INTERFACE_CODES`, so "FE sends only companyId; backend resolves interface_code" holds uniformly across search and create.

---

# Appendix A — Phase A Frozen API Contract (RELEASED)

**Status:** Frozen as of Phase A completion. These request/response shapes are stable. **Phase B (and later) must not change them unless absolutely necessary** — prefer database and service-layer changes. If a requirement appears to force an API change, STOP and document the reason (contract, caller impact, alternative considered) before implementing.

### GET /api/companies
- **Auth:** required. **Request:** none.
- **Response `data`:** `Array<{ id, code, name }>` — **never** `interface_code`.
```jsonc
{ "success": {"status":true,"code":200,"message":"Companies fetched successfully"},
  "data": [ {"id":"…","code":"10EC","name":"10EC"}, {"id":"…","code":"20EC","name":"20EC"} ],
  "error": null }
```

### GET /api/appointments/irm-search
- **Query:** `vin?`, `reg?`, `phone?`, `companyId?` (preferred), `interfaceCode?` (legacy — deprecated, retained for backward compat).
- **`data`:** always an array (`IrmCustomerResult[]`, `[]` when not FOUND).
- **`meta.outcome`:** `FOUND | NOT_FOUND | UNAVAILABLE | SWITCH_COMPANY`; plus `meta.company` (resolved interface code or null), `meta.source`, and `meta.ownedByCompany?: { code, interfaceCode }` (only on SWITCH_COMPANY).
- **Errors:** `400` when a supplied `companyId` is unknown/inactive.

### POST /api/appointments
- **Request:** existing fields **plus** optional `companyId` (uuid). Omitting it behaves exactly as pre-Phase-A.
- **Response:** unchanged envelope. **Errors:** `400` when a supplied `companyId` is unknown/inactive.
- **Phase A semantics:** `companyId` is validated + logged only — NOT persisted, NOT pushed to Evolve, NOT required.

### Change-control note for Phase B
Phase B (persist `vehicles.owning_company_id`, `appointments.company_id` snapshot, `customer_company_links`) is expected to require **no** contract change: `companyId` is already accepted by `POST /appointments`. Phase B consumes the already-accepted `companyId` and writes it via the service/DB layer only. The `POST /appointments` **response** MAY additively echo `companyId` in `data` (additive, non-breaking); anything beyond that must follow the STOP-and-explain rule above.

---

# Appendix B — Vehicle & Company Ownership Rules (Invariants)

These are binding architectural invariants for Phase B onward.

1. **`vehicles.owning_company_id` is fill-blanks-only.** Appointment creation MAY *initialize* a vehicle's owning company (NULL → company) but MUST NEVER overwrite an existing non-NULL owner. Implementation uses a guarded write (`... WHERE owning_company_id IS NULL`).
2. **Ownership transfers are authoritative Evolve events, not appointment events.** A vehicle's owning company changes only from an authoritative Evolve FOUND (Phase 4 last-authoritative-wins), never from booking an appointment. The appointment company is a snapshot and never reassigns ownership.
3. **`customer_company_links.company_id` uses `ON DELETE RESTRICT`.** Companies are deactivated (`is_active = false`), never deleted; RESTRICT protects existing links. (`customer_id` uses `ON DELETE CASCADE` — a link is meaningless without its customer.)
4. **`customer_company_links` writes are idempotent.** Inserts use `ON CONFLICT (customer_id, company_id) DO NOTHING`, so retries and duplicate submissions are safe and never create duplicate links.
5. **All ownership writes occur inside the existing `createAppointment` transaction.** No partial ownership state is possible; a rollback discards customer, link, vehicle, and appointment together.

---

# Appendix C — Persistence Model (FROZEN / RELEASED)

**Status:** Released as of Phase B completion. The following are binding architectural invariants and **must not change without explicit approval**. Phase C and later phases consume this model; they do not alter it.

### The three ownership stores (canonical)
| Concern | Column / table | Authoritative? |
|---|---|---|
| Vehicle → company ownership | `vehicles.owning_company_id` | **Yes — the single source of truth** |
| Appointment booking context | `appointments.company_id` | **No — snapshot / reporting only** |
| Customer ↔ company mapping | `customer_company_links` | Mapping only (per-company `cust_sequence_id`) |

### Invariants
1. **`vehicles.owning_company_id` is authoritative.** It is the only source of truth for which company a vehicle belongs to.
2. **Vehicle ownership may only be *initialized* during appointment creation** (NULL → company, fill-blanks-only).
3. **Vehicle ownership may NEVER be overwritten by appointment creation.** The guarded write (`WHERE owning_company_id IS NULL`) is the only appointment-time write.
4. **Only authoritative Evolve synchronization may change ownership once established** (Phase 4 FOUND, last-authoritative-wins). No other code path reassigns it.
5. **`appointments.company_id` is never authoritative.** It is a snapshot for reporting/context and a NULL-fallback for interface-code resolution — never a source that reassigns vehicle ownership.
6. **`customer_company_links` is append-only from the application's perspective.** Links are inserted idempotently (`ON CONFLICT DO NOTHING`); the app never deletes or reassigns them. (Phase C may *fill* `cust_sequence_id`/`crm_reference_no` on an existing link — an in-place enrichment, not a delete/reassign.)
7. **No additional ownership columns or duplicate company references** may be introduced. The three stores above are the complete model.

### Interface-code resolution reads (Phase C consumes, does not change)
```
RO sync:        vehicle.owning_company_id → (NULL) appointments.company_id → (NULL) env default
Customer sync:  the company the customer was created/linked under (customer_company_links)
```
All resolution goes through `CompanyResolver` (companyId → interface_code). `InterfaceCode` is never persisted on any business entity.

### Company resolution invariant (Phase C)
**Company resolution must never fail a sync solely because no unique company can be resolved.** If `CompanyResolver` cannot resolve exactly one active company, it yields `null` and the caller falls back to `EVOLVE_INTERFACE_CODE`. Specifically for customer sync by links: **0 links → env default; exactly 1 link → resolve that company; >1 links → AMBIGUOUS → env default (never guess)**. Ambiguous fallback emits a structured warning (`customerId`, link count, `reason=AMBIGUOUS_COMPANY`, using env default) for observability only — it must not change runtime behaviour. Legacy records (NULL ownership / no link) therefore always behave exactly as today via the env fallback.
