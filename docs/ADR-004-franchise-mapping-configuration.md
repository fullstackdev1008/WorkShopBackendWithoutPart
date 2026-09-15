# ADR-004 — Client-configurable Vehicle-Make → Franchise mapping

> **SUPERSEDED.** This make→franchise auto-resolution approach was replaced by an
> explicit per-job-card Franchise / Service-Dept selection. The live Evolve
> `IRM_GetLookupDropdownTables` response was found to include franchise + service-dept
> **names** (`Franshise`, `SDName`) alongside the numeric `FranchiseSeqID`/`SDNumber`,
> so the labeled pairs are synced into `franchise_service_departments` and chosen on
> the job card (see `resolveRoFranchise`). The `vehicle_make_franchise_mappings` table
> (migration 0049) and its module were removed. Kept for historical context only.

- **Status:** Superseded (see banner above)
- **Date:** 2026-07-10
- **Context:** AI-3 (Evolve Integration Testing — Action Item 3: "FAW job cards are opening under the Tata franchise/service department instead of FAW; job numbers should start with 'FO' for FAW.")
- **Related:** ADR-001 (multi-company appointments), ADR-002 (customer identity), ADR-003 (vehicle model identity)

## Decision

Introduce a local, client-populated configuration table
`vehicle_make_franchise_mappings` (`vehicle_make → franchise_seq_id + service_dept`,
optionally scoped per company) and resolve the RO `<FranchiseSeqID>` /
`<ServiceDept>` from it at job-card-sync time. The table ships **empty**; no
FranchiseSeqID values are seeded or guessed. Until the client populates it, RO
creation keeps its existing `'1'` / `'1'` fallback — byte-identical to prior
production behaviour.

## Why automatic mapping is impossible

A repository-wide investigation (all Evolve XML samples, the `_Functions.xlsx`
spec, the `EUG_Evolve_IRM` PDF, and the full backend) proved that Evolve exposes
**no data that ties a vehicle make to a franchise**:

- The only franchise fields Evolve defines are `FranchiseSeqID` (Integer) and
  `SDNumber` (Integer), documented in
  `apitest/IRM20251009 2/14b__ROHistoryLookup_Response.xml:51-52` as backed by
  `IRM_GetLookupDropdownTables` → table `FranchiseServiceDepartments`. Both are
  opaque numeric IDs.
- The `FranchiseServiceDepartments` lookup response carries **no** name / make /
  brand / dealer field — it is a bare scalar placeholder
  (`apitest/IRM20251009 2/07b_GetLookupDropdownTables_Response.xml:34`), and a
  full-response search for `FranchiseName`/`FranchiseDescription`/etc. returns
  nothing.
- Every populated sample value is the generic `FranchiseSeqID=1`
  (`15a_ROMaintenance_Request.xml:46`; all rows of `14bB_ROHistoryLookup_Response.xml`),
  giving no discriminating example.
- No Evolve function is a franchise/dealer/company **registry** (35 functions
  enumerated; none is `IRM_GetFranchises`/`IRM_GetDealers`/`IRM_GetCompanies`).
- Locally, neither `companies` (`db/models/companies.ts`: `code`, `name`,
  `interface_code` only) nor `vehicle_makes` carries a franchise link, and the
  existing `franchise_service_departments` cache stores only
  `franchise_seq_id` + `sd_number` (`db/models/franchiseServiceDepartments.ts`)
  — no make/name column, as its migration `0047` explicitly records.

Because no attribute connects a make to a `FranchiseSeqID`, any automatic
resolver would have to **invent** which numeric ID is "FAW". Inventing it would
misroute the RO / FO number series in Evolve and cause the exact
accounting-misallocation the client reported — so it is prohibited.

## Why a configuration table exists

The mapping is real-world knowledge held by the client/dealer, not derivable
data. Storing it locally lets the integration resolve deterministically from
values the client confirms, while keeping the "no guessing" guarantee: the table
is the single source of truth, it starts empty, and it is only ever filled with
client-supplied `FranchiseSeqID` / `SDNumber` values (optionally validated
against the `franchise_service_departments` cache of Evolve-valid pairs).

## Why values must come from the client

Only the client/Evolve can state which `FranchiseSeqID` + `SDNumber` correspond
to FAW, Dayun, Tata, etc., and which vehicle makes route to which franchise.
This is dealer/OEM configuration in Evolve, invisible to any API we consume.
Populating the table with anything else would be a guess.

## Design

- **Table** `vehicle_make_franchise_mappings` (migration `0049`): `id`,
  `company_id` (nullable FK → `companies`, NULL = global), `vehicle_make`,
  `franchise_seq_id`, `service_dept`, `is_active`, timestamps. Partial unique
  indexes enforce one active mapping per (company, make) and per global make.
- **Resolution** (`FranchiseMappingService.resolve(make, companyId?)`): exactly
  one active mapping → return it; none → `null`; more than one → throw
  `AmbiguousFranchiseMappingError` (never picks arbitrarily). A company-scoped
  mapping deterministically overrides a global one for the same make.
- **Integration** (`jobCardEvolveSync.resolveRoFranchise`): calls the resolver;
  on a hit forwards the values; on `null` logs `UNMAPPED_FRANCHISE`; on ambiguity
  logs `AMBIGUOUS_FRANCHISE_MAPPING`. Both non-hit paths return `{}` so the XML
  builder keeps `FranchiseSeqID/ServiceDept = '1'`. **The existing fallback is
  unchanged.**
- **Admin CRUD**: `GET/POST/PUT/DELETE /api/franchise-mappings`, gated by
  `ROLE_MANAGEMENT` (same as Designations / Model Service Types).

## Consequences

- **Positive:** FAW (and any other make) routes to the correct franchise the
  moment the client enters the mapping — no code change, no redeploy. No guessed
  IDs ever reach Evolve. Backward compatible while the table is empty.
- **Negative / limits:** Correct routing depends on the client maintaining the
  table. An unmapped make silently uses `'1'` (logged as `UNMAPPED_FRANCHISE`) —
  this preserves RO creation but does not fix routing until the mapping is added.
  Hard-failing instead of falling back is a future product decision, not a
  default here.

## Status of Action Item 3

Infrastructure complete and dormant-safe. **Blocked on the client** to supply the
FAW/Dayun/Tata `FranchiseSeqID` + `SDNumber` values and the make→franchise
assignment, which are then entered via the admin API. No further development is
required to activate resolution once those values are provided.
