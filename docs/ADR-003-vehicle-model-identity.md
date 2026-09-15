# ADR-003 — Vehicle Model Identity Strategy

**Status:** Proposed (documentation only; no code change)
**Related:** ADR-001 (multi-company appointment architecture), ADR-002 (customer identity model)
**Scope:** How the appointment vehicle edit flow resolves a saved vehicle back to the master Make → Model → Model Code catalog, why that resolution is currently name-based, and the canonical identifier we should adopt.

---

## Background

The appointment "Edit Vehicle" flow ([TrueGear `AppointmentVehicleDetails.tsx`]) has to re-hydrate three dependent dropdowns from a saved vehicle:

```
Vehicle (saved row)
  → Make        (master: vehicle_makes)
    → Model     (master: vehicle_models, loaded per make)
      → Model Code (master: vehicle_model_codes, loaded per model)
```

The dropdowns are a **reactive cascade**: selecting a Make loads its Models (`listModelsByMake(makeId)`), selecting a Model loads its Model Codes (`listModelCodes(modelId)`). To prefill them on edit, the flow must first turn the saved vehicle back into the corresponding **master-list IDs** (`makeId`, `modelId`) so the cascade can run and each level can select its saved value.

The saved vehicle, however, does **not** store those master IDs. It stores only **display/description strings** (`brand`, `model`) plus a nullable `model_code`. So the edit flow re-derives the master IDs by **matching the stored strings against the master tables by name** — `vehicle_makes.name` for the make and `vehicle_models.name` for the model. This name-matching step is the subject of this ADR.

---

## Current Implementation

**`vehicles` table stores (relevant columns):**
- `brand` — free-text make name (e.g. `"IVECO"`)
- `model` — free-text model name/description (e.g. `"50 C15V 15 F/C P/V"` or `"Daily"`)
- `model_description` — secondary description string
- `model_code` — nullable Evolve model code (e.g. `"AW12LV"`), often empty

**`vehicles` table does NOT store:**
- `model_id` — no foreign key to `vehicle_models.id`
- `series_id` — no foreign key to any series/model tier

(The only foreign keys on `vehicles` are `customer_id`, `created_by`, `updated_by`.)

**Master catalog:**
- `vehicle_makes (id, name, …)`
- `vehicle_models (id, make_id, name, …)` — loaded per make
- `vehicle_model_codes (id, model_id → vehicle_models.id, code, mandm_code, description, model_year)` — unique per `(model_id, code, model_year)`, loaded per model via `IRM_GetModelCodes`

**Why matching is name-based:** because the vehicle carries no `model_id`, the only link back to the catalog is the denormalized `brand`/`model` strings. The edit flow therefore compares those strings to `vehicle_makes.name` / `vehicle_models.name` to recover `makeId` / `modelId`. Vehicles **created through the app** set `model` to the exact selected master model name, so they match. Vehicles **sourced from Evolve/IRM** set `model` to the Evolve `ModelDescription`, a free-text string that does not equal a master model name.

---

## Why This Is Fragile

Name matching breaks whenever the stored string is not the master display name. Example:

```
Stored vehicles.model:  "50 C15V 15 F/C P/V"    (Evolve ModelDescription)
Master vehicle_models:  "Daily"                 (catalog entry)
```

These cannot be matched reliably:
- The stored value is a **description with variant/spec suffixes**, not the catalog model name.
- There is no normalization that safely maps one to the other without guessing (and fuzzy/`contains` matching is explicitly out of the business rules).
- When the match fails, `modelId` stays empty, which **disables the dependent Model Code dropdown** — the exact edit-prefill failure this ADR addresses.

**Why `model_code` cannot be the primary identifier:**
- **Nullable / frequently empty** — many vehicles (including IRM-created ones) have no code, so it can't be relied on as the key.
- **Not globally unique** — `vehicle_model_codes` is unique only per `(model_id, code, model_year)`; the same `code` string can recur across different models and years.
- **Scoped by `(model_id, model_year)`** — a code is only meaningful *within* a model; it presupposes the `model_id` we're trying to find.
- **No reverse lookup exists** — the API resolves `model_id → codes` (`listModelCodes`), never `code → model_id`. Deriving a model from a code would require a new, ambiguity-prone endpoint.

---

## Alternatives Considered

| # | Option | Pros | Cons |
|---|--------|------|------|
| 1 | **Exact string match** (`vehicles.model` == `vehicle_models.name`) | Simple; correct for app-created vehicles | Fails for all IRM/Evolve vehicles whose `model` is a description; brittle to catalog renames |
| 2 | **Fuzzy string matching** (edit distance / token overlap) | Might catch near-misses | Non-deterministic; can mis-map to the wrong model; **not part of business rules**; unsafe for a value that flows to Evolve |
| 3 | **`startsWith` / first-token match** (current fallback) | Recovers some near-misses (e.g. `"Daily 50C15"` → `"Daily"`) | Still a heuristic; false positives possible; does not solve description-style strings |
| 4 | **`model_code` lookup** | A code is a more precise token than a name | Nullable, not globally unique, scoped by `(model_id, model_year)`, and no `code → model_id` reverse lookup — cannot be the primary key |
| 5 | **`model_id` foreign key on the vehicle** | Deterministic, stable, rename-proof; direct cascade with no string matching; unambiguous Model Code prefill | Requires a schema column, write-path population, and a backfill for legacy rows |

---

## Decision

Introduce a canonical foreign key on the vehicle:

```
vehicles.model_id  (nullable uuid, FK → vehicle_models.id)
```

`model_id` becomes the **canonical vehicle → catalog relationship**. When present, the edit flow resolves Make/Model directly from it (no name matching), and the Model Code prefill selects the saved `model_code` within that model. Name matching is retained only as a **fallback** for rows where `model_id` is still null, until adoption reaches 100%.

`model_code` remains a stored attribute (the selected code) but is explicitly **not** the identity key — it is scoped by `model_id`.

---

## Migration Strategy (phased)

**Phase 1 — Add the column (additive, no behavior change).**
Add nullable `vehicles.model_id` (FK → `vehicle_models.id`, `ON DELETE SET NULL`). No backfill; nothing reads it yet.

**Phase 2 — Populate on all new writes.**
When a vehicle is created/updated through the app (appointment vehicle form, vehicle create) and a master model is selected, persist its `model_id`. Where the Evolve model-code sync resolves a model, persist `model_id` there too. From here, all *new* vehicles carry the canonical key.

**Phase 3 — Backfill existing records (best-effort).**
One-time job that resolves legacy rows' `brand`/`model`/`model_code` against the master tables and sets `model_id` where an unambiguous match exists. Rows with no confident match are left null (they continue to use name-matching). Log the matched/unmatched counts; never guess a `model_id`.

**Phase 4 — Switch the edit flow to `model_id`.**
Edit prefill uses `model_id` first (direct Make/Model resolution + Model Code select); falls back to the existing name match only when `model_id` is null.

**Phase 5 — Retire legacy name matching.**
Once `model_id` adoption reaches ~100% (new writes + backfill), remove the name-matching fallback from the edit flow, leaving `model_id` as the sole resolution path.

---

## Risks

- **Legacy IRM data** — historical vehicles carry Evolve `ModelDescription` strings that may not correspond to any master model row; these will remain `model_id = null` after backfill and keep relying on name matching until manually reconciled or re-synced.
- **Unmatched historical records** — the Phase 3 backfill will leave a residual set of vehicles with no `model_id`; the fallback must survive until those are resolved, so Phase 5 must be gated on a measured adoption threshold, not a date.
- **Master catalog changes** — if `vehicle_models` rows are renamed, merged, or deleted, existing `model_id` references must be handled (`ON DELETE SET NULL` degrades gracefully to the name-match fallback); catalog re-syncs should preserve IDs where possible to avoid orphaning.
- **Ambiguous backfill matches** — a stored string may plausibly match more than one master model; the backfill must skip (leave null) rather than pick, to avoid silently binding a vehicle to the wrong model.

---

## Benefits

Adopting `model_id` eliminates the current failure modes:
- **No fragile string matching** — resolution is a deterministic FK lookup, immune to description suffixes, casing, and spacing.
- **No edit-prefill failures** — Make/Model resolve directly, so the dependent Model Code dropdown always loads and can select the saved code (the specific bug that motivated this ADR).
- **No dependency on display names** — catalog renames no longer break existing vehicles; the relationship is by stable ID, not by label.
- **Correct data flowing to Evolve** — a precisely identified model underpins a correct Model Code on the RO, reducing downstream sync deferrals.

---

## Notes

This ADR is documentation only. The immediate edit-prefill limitation is understood and contained (unmatched models surface the raw text and leave Model Code empty without crashing). The `model_id` work above is a separate, migration-bearing task to be scheduled; no production code is changed by this record.
