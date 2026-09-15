# WorkShop Backend — Database Schema Notes

## Quick System Overview

This is a **vehicle workshop management system**. The core flow is:

```
Customer → Vehicle → Check-In → QC Inspection → Job Card → Parts → Billing
```

---

## Table Groups

### 1. AUTH & USERS
| Table | Purpose | Key FK |
|-------|---------|--------|
| `roles` | Role definitions (admin, advisor, etc.) | — |
| `users` | System login accounts | `role_id → roles` |
| `permissions` | What each role can access | `role_id → roles` |

### 2. CUSTOMERS
| Table | Purpose | Key FK |
|-------|---------|--------|
| `customers` | Customer master record | — |
| `customer_contacts` | Phone numbers per customer | `customer_id → customers` (cascade delete) |
| `customer_addresses` | Addresses per customer | `customer_id → customers` (cascade delete) |
| `customer_profiles` | Marketing consent / preferences | `customer_id → customers` (cascade delete) |

### 3. VEHICLES
| Table | Purpose | Key FK |
|-------|---------|--------|
| `vehicle_makes` | BMW, Toyota, etc. | — |
| `vehicle_models` | Models per make | `make_id → vehicle_makes` (cascade delete) |
| `vehicles` | Vehicle master record | `customer_id → customers` |
| `vehicle_images` | Stored photos | `vehicle_id → vehicles` (cascade delete) |
| `vehicle_accessories` | Factory/dealer accessories | `vehicle_id → vehicles` (cascade delete) |
| `vehicle_service_history` | Past service records | `vehicle_id → vehicles` (cascade delete) |

### 4. WORKSHOP VISIT (Check-In)
| Table | Purpose | Key FK |
|-------|---------|--------|
| `vehicle_check_ins` | One record per visit | `vehicle_id → vehicles` |
| `vehicle_check_in_photos` | Entry photos (Front/Rear/etc.) | `vehicle_check_in_id → vehicle_check_ins` |

### 5. QC INSPECTION
| Table | Purpose | Key FK |
|-------|---------|--------|
| `qc_checklist_templates` | Master checklist items (EXTERIOR/INTERIOR/BRAKE) | — |
| `qc_inspections` | One inspection per check-in | `vehicle_check_in_id → vehicle_check_ins` |
| `qc_inspection_items` | Per-item results (PASS/FAIL/NA) | `inspection_id → qc_inspections` |
| `qc_inspection_photos` | Photos per inspection item | `inspection_item_id → qc_inspection_items` |
| `qc_confirmation_components` | Components verified | `inspection_id → qc_inspections` |
| `qc_workshop_rework` | Rework notes | `inspection_id → qc_inspections` |

### 6. JOB CARDS & PARTS
| Table | Purpose | Key FK |
|-------|---------|--------|
| `job_cards` | Estimate/work order | `vehicle_id → vehicles`, `inspection_id → qc_inspections`, `vehicle_check_in_id → vehicle_check_ins` |
| `job_card_items` | Line items (labour + parts) | `job_card_id → job_cards` (cascade delete) |
| `part_requests` | Parts sent to Parts Manager | `job_card_id → job_cards`, `job_card_item_id → job_card_items`, `vehicle_id → vehicles` |
| `parts_master` | Parts catalogue | — |

### 7. APPOINTMENTS
| Table | Purpose | Key FK |
|-------|---------|--------|
| `slot_configurations` | Time slots and capacity | — |
| `appointments` | Booked appointments | `customer_id → customers`, `vehicle_id → vehicles`, `service_advisor_id → users`, `check_in_id → vehicle_check_ins` |
| `appointment_reschedules` | Reschedule history | `appointment_id → appointments` (cascade delete) |
| `complaints` | Complaint types reference data | — |

### 8. REFERENCE TABLES (standalone lookup data)
| Table | Purpose |
|-------|---------|
| `service_types` | Service type catalogue (code + name + duration) |
| `model_service_type_assignments` | Maps Make+Model → Service Type + parts |
| `vehicle_conditions` | Condition codes |
| `vehicle_colours` | Ext/Int colour codes |
| `provinces` | Province lookup |
| `ro_statuses` | Repair Order statuses |
| `service_advisors` | Advisor records (separate from users) |

---

## Vehicle Status Flow

```
Entry (Draft)
    ↓  [security confirms entry]
Vehicle IN
    ↓  [QC inspector starts]
Inspection (Draft)
    ↓  [QC inspection completed]
Inspection Done
    ↓  [SA creates job card]
Job Card (Draft)
    ↓  [SA requests parts approval]
Job Card (Pending Parts Approval)
    ↓  [Parts manager confirms]
Job Card (Parts Approval Done)
    ↓  [SA shares estimate with customer]
Job Card (Pending Cust. Approval)
    ↓
  ┌─ Job Card (Full Cust. Approval)
  └─ Job Card (Partial Cust. Approval)
    ↓  [work begins]
In Service
    ↓  [work completed]
Ready for Billing
    ↓  [payment done]
Completed
```

---

## Job Card Status Flow

```
DRAFT
  ├─→ PENDING_PARTS (parts needed)
  │       ↓
  │   PARTS_CONFIRMED
  │       ↓
  └─→ SHARED (estimate sent to customer)
          ├─→ APPROVED
          ├─→ PARTIALLY_APPROVED
          ├─→ REJECTED
          └─→ MODIFICATION_REQUESTED
                  ↓ (SA edits)
              back to DRAFT
```

---

## How to Query Across Tables (Drizzle ORM)

```typescript
// Get vehicle with customer info
const [vehicle] = await db
  .select()
  .from(vehicles)
  .leftJoin(customers, eq(vehicles.customerId, customers.id))
  .where(eq(vehicles.id, vehicleId));

// Get job card with items
const jobCard = await db.select().from(jobCards).where(eq(jobCards.id, id));
const items = await db.select().from(jobCardItems).where(eq(jobCardItems.jobCardId, id));

// Get QC inspection via check-in
const [inspection] = await db
  .select()
  .from(qcInspections)
  .innerJoin(vehicleCheckIns, eq(qcInspections.vehicleCheckInId, vehicleCheckIns.id))
  .where(eq(vehicleCheckIns.vehicleId, vehicleId));

// Cascade delete — deleting a customer automatically deletes:
//   customer_contacts, customer_addresses, customer_profiles
// Deleting a vehicle deletes:
//   vehicle_images, vehicle_accessories, vehicle_check_ins,
//   vehicle_service_history (and their children)
```

---

## ER Diagram (Mermaid)

```mermaid
erDiagram

  roles {
    uuid id PK
    varchar name
    varchar slug UK
    boolean is_active
  }

  users {
    uuid id PK
    varchar username UK
    varchar email UK
    uuid role_id FK
    boolean is_active
  }

  permissions {
    uuid id PK
    uuid role_id FK
    varchar resource
    varchar action
  }

  customers {
    uuid id PK
    varchar crm_reference_no
    varchar cust_sequence_id
    varchar customer_type
    varchar first_name
    varchar last_name
    varchar primary_email
    boolean active_customer
  }

  customer_contacts {
    uuid id PK
    uuid customer_id FK
    varchar contact_type
    varchar contact_number
  }

  customer_addresses {
    uuid id PK
    uuid customer_id FK
    varchar address_type
    varchar city
  }

  customer_profiles {
    uuid id PK
    uuid customer_id FK
    boolean receive_email
    boolean receive_sms
  }

  vehicle_makes {
    uuid id PK
    varchar name UK
  }

  vehicle_models {
    uuid id PK
    uuid make_id FK
    varchar name
  }

  vehicles {
    uuid id PK
    uuid customer_id FK
    varchar brand
    varchar model
    varchar vin UK
    varchar registration_number
    varchar status
    timestamp entry_time
    integer odometer_last
  }

  vehicle_images {
    uuid id PK
    uuid vehicle_id FK
    varchar image_category
    varchar image_path
  }

  vehicle_accessories {
    uuid id PK
    uuid vehicle_id FK
    varchar accessory_name
    numeric unit_price
  }

  vehicle_check_ins {
    uuid id PK
    uuid vehicle_id FK
    varchar status
    timestamp check_in_time
    integer odometer_reading
    boolean is_active
  }

  vehicle_check_in_photos {
    uuid id PK
    uuid vehicle_check_in_id FK
    varchar photo_type
    varchar image_url
  }

  qc_inspections {
    uuid id PK
    uuid vehicle_check_in_id FK
    varchar status
    varchar overall_status
    varchar service_type
    timestamp completed_at
  }

  qc_inspection_items {
    uuid id PK
    uuid inspection_id FK
    varchar category
    varchar item_code
    varchar result
    text comment
  }

  qc_inspection_photos {
    uuid id PK
    uuid inspection_item_id FK
    varchar image_url
  }

  job_cards {
    uuid id PK
    uuid vehicle_id FK
    uuid inspection_id FK
    uuid vehicle_check_in_id FK
    varchar status
    numeric subtotal
    numeric tax_amount
    numeric total_estimate
    varchar approval_token UK
    timestamp shared_at
    timestamp approved_at
  }

  job_card_items {
    uuid id PK
    uuid job_card_id FK
    varchar job_description
    varchar parts_required
    numeric parts_cost
    numeric labour_cost
    integer quantity
    numeric line_total
    boolean is_approved_by_customer
  }

  part_requests {
    uuid id PK
    uuid job_card_id FK
    uuid job_card_item_id FK
    uuid vehicle_id FK
    varchar part_name
    integer quantity
    varchar status
  }

  appointments {
    uuid id PK
    varchar booking_ref UK
    uuid customer_id FK
    uuid vehicle_id FK
    uuid service_advisor_id FK
    uuid check_in_id FK
    varchar service_type
    date appointment_date
    varchar appointment_time
    varchar status
  }

  appointment_reschedules {
    uuid id PK
    uuid appointment_id FK
    date previous_date
    date new_date
    text reason
  }

  slot_configurations {
    uuid id PK
    varchar time UK
    integer capacity
    boolean is_active
  }

  service_types {
    uuid id PK
    varchar code UK
    varchar name
    varchar category
    integer estimated_duration_minutes
  }

  model_service_type_assignments {
    uuid id PK
    uuid make_id FK
    uuid model_id FK
    uuid service_type_id FK
    varchar part_name
    numeric unit_price
  }

  vehicle_service_history {
    uuid id PK
    uuid vehicle_id FK
    varchar service_type
    date service_date
    numeric total_cost
  }

  qc_checklist_templates {
    uuid id PK
    varchar category
    varchar item_code UK
    varchar item_label
    integer sort_order
    boolean is_active
  }

  %% AUTH
  roles ||--o{ users : "has"
  roles ||--o{ permissions : "has"

  %% CUSTOMER
  customers ||--o{ customer_contacts : "has"
  customers ||--o{ customer_addresses : "has"
  customers ||--o{ customer_profiles : "has"

  %% VEHICLE
  customers ||--o{ vehicles : "owns"
  vehicle_makes ||--o{ vehicle_models : "has"
  vehicles ||--o{ vehicle_images : "has"
  vehicles ||--o{ vehicle_accessories : "has"
  vehicles ||--o{ vehicle_service_history : "has"

  %% VISIT
  vehicles ||--o{ vehicle_check_ins : "visits"
  vehicle_check_ins ||--o{ vehicle_check_in_photos : "has"

  %% QC
  vehicle_check_ins ||--o{ qc_inspections : "has"
  qc_inspections ||--o{ qc_inspection_items : "has"
  qc_inspection_items ||--o{ qc_inspection_photos : "has"

  %% JOB CARD
  vehicles ||--o{ job_cards : "has"
  qc_inspections ||--o{ job_cards : "linked to"
  vehicle_check_ins ||--o{ job_cards : "linked to"
  job_cards ||--o{ job_card_items : "has"
  job_cards ||--o{ part_requests : "raises"
  job_card_items ||--o{ part_requests : "raises"

  %% APPOINTMENTS
  customers ||--o{ appointments : "books"
  vehicles ||--o{ appointments : "for"
  users ||--o{ appointments : "assigned advisor"
  vehicle_check_ins ||--o| appointments : "linked"
  appointments ||--o{ appointment_reschedules : "has"

  %% MODEL-SERVICE MAPPING
  vehicle_makes ||--o{ model_service_type_assignments : "in"
  vehicle_models ||--o{ model_service_type_assignments : "in"
  service_types ||--o{ model_service_type_assignments : "in"
```

---

## Key Rules to Remember

| Rule | Detail |
|------|--------|
| **One visit per vehicle** | `vehicle_check_ins` has `is_active` flag — only one active at a time |
| **One inspection per visit** | `qc_inspections` links to `vehicle_check_in_id` |
| **Job card links three things** | `vehicle_id` + optionally `inspection_id` + `vehicle_check_in_id` |
| **Part request lifecycle** | `pending → available/unavailable → dispatched` |
| **Approval token** | Generated on job card `SHARED`, 64-char unique token for customer approval URL |
| **Cascade deletes** | Contacts/addresses delete with customer; images/check-ins/job-cards delete with vehicle |
| **Slot capacity** | `slot_configurations` limits how many appointments per time slot |
