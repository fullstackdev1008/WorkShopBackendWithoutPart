/**
 * Job Card → Evolve (IRM_ROMaintenance) sync.
 *
 * Mirrors the proven customer-sync architecture ([customerEvolveSync.service.ts]).
 * Gated behind EVOLVE_JOB_CARD_SYNC_ENABLED (default false) — inert until enabled.
 * Fire-and-forget, post-commit; never throws; never blocks the caller.
 *
 * UAT-confirmed (2026-06-19): envelope Evolve/WMS/WMS; blank RONumber CREATEs and
 * Evolve returns the real number as DMSReferenceNo; populated RONumber UPDATEs
 * idempotently; Evolve auto-creates the vehicle for an unknown VIN. Model codes
 * resolve from vehicles.model (= Evolve ModelDescription).
 *
 * Identifier strategy: we send our `evolve_crm_ro_ref` as CRMReferenceNo
 * (correlation only); Evolve returns DMSReferenceNo (= RONumber) — the
 * authoritative key — stored in `evolve_ro_number` and used for UPDATE/lookup.
 *
 * DEFERRED refinements (intentionally not in this version):
 *   - ROStatus mapping for COMPLETED/closed states (needs the ROStatuses
 *     dropdown; we send WIP/W which UAT accepts for all states).
 *   - Per-user ServiceAdvisorNumber / ServiceDept mapping (constants for now).
 *   - IRM_ROHistoryLookup "adopt-or-create" recovery for a create whose HTTP
 *     response is lost AFTER Evolve committed (narrow crash window → possible
 *     duplicate). Low risk at current volume; see TODO below.
 */
import { eq, and, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { jobCards, jobCardItems, vehicles, customers, vehicleCheckIns, users, appointments, serviceTypes, franchiseServiceDepartments } from '../db/models';
import { companyResolver } from './companyResolver.service';
import { env } from '../config/env';
import { roMaintenance, RoMaintenanceInput, RoJobHeaderJob, lookupRoHistory, normalizeEngineNumber } from './evolveIrm.service';
import {
  buildLabourLinesFromItems,
  LabourItemRow,
  LabourLineResolution,
  ResolvedLabourLine,
  RoJobDetailLine,
} from './evolveLabour';
import { resolveModelCode, ModelCodeConfidence } from './modelCodeResolver.service';
import { isEvolveJobCardSyncReady, isEvolveLabourLinesReady } from '../db/health';
// Shared identity authority (D2). isPlaceholderSeq is the ONE canonical copy;
// resolveCustomerEvolveId is the ONLY per-company outbound identity resolver.
import { isPlaceholderSeq, resolveCustomerEvolveId } from './customerIdentity.service';

// ── Full Evolve freeze ───────────────────────────────────────────────────────
// EVOLVE_SYNC_FREEZE stops ALL job-card traffic to Evolve for the whole
// lifecycle — CREATE included, so a newly created job card never reaches Evolve
// at all. Checked as the FIRST statement of every exported entry point below,
// before any row is loaded and before any state is written, so a frozen card is
// left completely untouched (no status change, no attempt counter, no backoff)
// and the reconcile sweep has nothing to re-drive.
//
// Deliberately independent of evolve_ro_number: a brand-new card has none, and
// the whole point is that it must never get one.
function isEvolveSyncFrozen(path: 'create' | 'update' | 'reconcile', jobCardId?: string): boolean {
  if (!env.EVOLVE_SYNC_FREEZE) return false;
  // Reconcile runs every 15 minutes; logging it each sweep would be noise.
  if (path !== 'reconcile') {
    console.log(
      `[JobCardEvolveSync] EVOLVE_SYNC_FREEZE is on — ${path} for job card ${jobCardId} skipped; nothing sent to Evolve`,
    );
  }
  return true;
}

// ── ModelCode mode + gate ────────────────────────────────────────────────────
type ModelCodeMode = 'OFF' | 'LOG' | 'WARN' | 'ENFORCE';

interface ModelCodeGate {
  action: 'PROCEED' | 'DEFER' | 'MANUAL';
  modelCode: string;
  confidence: ModelCodeConfidence | 'STORED' | 'OFF';
  reason?: string;
}

// Decide the ModelCode to send and whether the RO may proceed. READ-ONLY: the
// resolver never calls Evolve and never writes. NO first-code fallback in any
// mode — anything below HIGH is sent blank (LOG/WARN, no enforcement) or
// deferred/parked (ENFORCE). A non-blank stored model_code is always trusted.
//
// FAIL-CLOSED INVARIANT (ENFORCE): this function returns action:'PROCEED' with a
// blank modelCode ONLY in OFF/LOG/WARN (fail-open shadow/legacy modes). Under
// ENFORCE every non-stored/non-HIGH outcome is parked (DEFER/MANUAL) and no RO is
// sent. ENFORCE is unconditional — it is NOT downgraded by any other flag.
async function gateModelCode(row: JobCardSyncRow): Promise<ModelCodeGate> {
  const stored = (row.modelCode ?? '').trim();
  if (stored) return { action: 'PROCEED', modelCode: stored, confidence: 'STORED' };

  const mode = env.EVOLVE_MODELCODE_MODE as ModelCodeMode;
  if (mode === 'OFF') return { action: 'PROCEED', modelCode: '', confidence: 'OFF' };

  const r = await resolveModelCode(row.brand, row.model); // catalog read-only
  if (r.confidence === 'HIGH' && r.code) {
    return { action: 'PROCEED', modelCode: r.code, confidence: 'HIGH' };
  }

  if (mode === 'ENFORCE') {
    if (r.confidence === 'AMBIGUOUS') {
      return { action: 'MANUAL', modelCode: '', confidence: r.confidence, reason: `MODELCODE_AMBIGUOUS:${(r.candidates ?? []).join('|')}` };
    }
    return { action: 'DEFER', modelCode: '', confidence: r.confidence, reason: `MODELCODE_${r.confidence}` };
  }

  // LOG / WARN — no enforcement; send blank (never a guess), just observe.
  if (mode === 'WARN') {
    console.warn(`[JobCardEvolveSync] WARN job card ${row.id} make/model="${row.brand}/${row.model}" resolver=${r.confidence} → sending blank ModelCode (review recommended)`);
  } else {
    console.log(`[JobCardEvolveSync] LOG job card ${row.id} make/model="${row.brand}/${row.model}" resolver=${r.confidence} wouldSend=${r.code ?? ''}`);
  }
  return { action: 'PROCEED', modelCode: '', confidence: r.confidence };
}

// ── Mandatory vehicle-field guard ────────────────────────────────────────────
// An RO requires VIN, RegistrationNo, Make and a (MM) ModelCode. We validate
// BEFORE calling IRM_ROMaintenance so a missing field parks the card for manual
// intervention with a clear reason — instead of emitting a blank field and
// getting an opaque Evolve reject parked as FAILED. `modelCode` is the value
// already decided by gateModelCode (stored or catalog-resolved); passing it in
// keeps this the single source of truth.
//
// ModelYear is intentionally NOT mandatory: Evolve's own IRM_Customer_VehicleLookup
// does not return a ModelYear for a vehicle, so we can never backfill it, and
// Evolve accepts a blank <ModelYear> on RO create (it auto-creates the vehicle
// for an unknown VIN). We still send it whenever we have it — see buildRoInput.
const MANDATORY_FIELDS: Array<{ label: string; get: (row: JobCardSyncRow, modelCode: string) => unknown }> = [
  { label: 'VIN',            get: (r) => r.vin },
  { label: 'RegistrationNo', get: (r) => r.registrationNo },
  { label: 'Make',           get: (r) => r.brand },
  { label: 'ModelCode',      get: (_r, mc) => mc },
];

function findMissingMandatoryFields(row: JobCardSyncRow, modelCode: string): string[] {
  return MANDATORY_FIELDS
    .filter(({ get }) => !String(get(row, modelCode) ?? '').trim())
    .map(({ label }) => label);
}

// Of the mandatory fields, only ModelCode is recoverable without human action:
// gateModelCode re-resolves it live on every reconcile tick against the
// vehicle_model_codes catalog, which the catalog-warm cron populates
// independently. So a ModelCode-only gap is DEFERRED (retry w/ backoff, then
// NEEDS_MANUAL at the cap) — matching the ENFORCE-mode MODELCODE_DEFER path.
// VIN/RegistrationNo/Make are vehicle-record attributes that no automated
// process backfills, so a missing one is terminal (NEEDS_MANUAL).
const RECOVERABLE_MANDATORY_FIELDS = new Set(['ModelCode']);

// Park a job whose mandatory-field validation failed, choosing the strategy by
// whether ANY non-recoverable field is missing. Reason lists every missing field.
async function parkMissingMandatory(
  jobCardId: string,
  attemptCount: number | null,
  missing: string[],
  logSuffix: string,
): Promise<void> {
  const reason = `MISSING_FIELDS: ${missing.join(', ')}`;
  const hasHardMissing = missing.some((f) => !RECOVERABLE_MANDATORY_FIELDS.has(f));
  if (hasHardMissing) {
    await parkManual(jobCardId, reason);
    console.warn(`[JobCardEvolveSync] job card ${jobCardId}${logSuffix} → NEEDS_MANUAL: ${reason}`);
  } else {
    // ModelCode-only — recoverable; retry with backoff (escalates at the cap).
    await parkRetryable(jobCardId, attemptCount, 'DEFERRED', reason);
    console.log(`[JobCardEvolveSync] job card ${jobCardId}${logSuffix} deferred: ${reason}`);
  }
}

// ── Backoff / state-machine helpers ──────────────────────────────────────────
function computeNextAttempt(attempt: number): Date {
  const delay = Math.min(
    env.EVOLVE_RO_RETRY_CAP_MS,
    env.EVOLVE_RO_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
  return new Date(Date.now() + delay);
}

// Retryable park: bump attempt + schedule backoff; at the cap, park NEEDS_MANUAL
// so a permanently-failing card can never auto-retry indefinitely.
async function parkRetryable(
  jobCardId: string,
  currentAttempt: number | null,
  status: 'DEFERRED' | 'FAILED',
  reason: string,
): Promise<void> {
  const attempt = (currentAttempt ?? 0) + 1;
  try {
    if (attempt >= env.EVOLVE_RO_MAX_ATTEMPTS) {
      await db.update(jobCards)
        .set({ evolveSyncStatus: 'NEEDS_MANUAL', evolveAttemptCount: attempt, evolveLastError: `[CAP] ${reason}`.slice(0, 500), updatedAt: new Date() })
        .where(eq(jobCards.id, jobCardId));
      return;
    }
    await db.update(jobCards)
      .set({ evolveSyncStatus: status, evolveAttemptCount: attempt, evolveNextAttemptAt: computeNextAttempt(attempt), evolveLastError: reason.slice(0, 500), updatedAt: new Date() })
      .where(eq(jobCards.id, jobCardId));
  } catch (persistErr) {
    console.error(`[JobCardEvolveSync] could not park ${jobCardId}:`, (persistErr as Error)?.message);
  }
}

// Terminal park — requires explicit user/system action to re-queue. Excluded
// from automatic reconcile (AMBIGUOUS / attempt-cap).
async function parkManual(jobCardId: string, reason: string): Promise<void> {
  try {
    await db.update(jobCards)
      .set({ evolveSyncStatus: 'NEEDS_MANUAL', evolveLastError: reason.slice(0, 500), updatedAt: new Date() })
      .where(eq(jobCards.id, jobCardId));
  } catch (persistErr) {
    console.error(`[JobCardEvolveSync] could not park-manual ${jobCardId}:`, (persistErr as Error)?.message);
  }
}

// Soft defer — a PRECONDITION is not yet met, which is NOT a failure.
//
// Deliberately NOT parkRetryable: that increments evolveAttemptCount and parks
// NEEDS_MANUAL at EVOLVE_RO_MAX_ATTEMPTS. The CREATE path is reachable from
// every UPDATE trigger (syncJobCardUpdateToEvolve routes to CREATE while no RO
// exists) and direct hook calls do NOT honour evolveNextAttemptAt — only the
// reconcile sweep does. So a job card shared/approved/started within a few
// minutes would burn the whole retry budget and park NEEDS_MANUAL for a missing
// data field, defeating the self-healing design.
//
// Instead: mark DEFERRED with a fixed base-interval retry window and leave the
// attempt counter untouched. The reconcile sweep re-picks DEFERRED rows whose
// window has elapsed, so the card syncs by itself the moment the data arrives,
// and repeated gate hits are idempotent — they can never escalate.
async function parkSoftDefer(jobCardId: string, reason: string): Promise<void> {
  try {
    await db.update(jobCards)
      .set({
        evolveSyncStatus: 'DEFERRED',
        evolveNextAttemptAt: new Date(Date.now() + env.EVOLVE_RO_RETRY_BASE_MS),
        evolveLastError: reason.slice(0, 500),
        updatedAt: new Date(),
        // evolveAttemptCount intentionally NOT written — see above.
      })
      .where(eq(jobCards.id, jobCardId));
  } catch (persistErr) {
    console.error(`[JobCardEvolveSync] could not soft-defer ${jobCardId}:`, (persistErr as Error)?.message);
  }
}

export type EngineNumberGate = { action: 'PROCEED' } | { action: 'DEFER'; reason: string };

// CREATE-ONLY engine-number gate. Exported for unit testing (same convention as
// buildRoMaintenanceXml) — pure: no DB, no network.
//
// Why CREATE only: on CREATE (blank RONumber) Evolve auto-creates the vehicle
// master from our payload, so a blank engine number is baked into Evolve's
// vehicle record permanently and Evolve then refuses to load a labour line
// under Cost Jobs. On UPDATE the vehicle already exists, the element is simply
// omitted when blank (evolveIrm.service.ts), and blocking would strand job
// cards that already have a live RO — so the UPDATE path is never gated.
//
// NULL / '' / '   ' are one state via the shared normalizeEngineNumber. No
// value is ever invented in any mode.
export function gateEngineNumberForCreate(
  row: Pick<JobCardSyncRow, 'id' | 'vin' | 'registrationNo' | 'engineNumber'>,
): EngineNumberGate {
  if (normalizeEngineNumber(row.engineNumber)) return { action: 'PROCEED' };

  const mode = env.EVOLVE_ENGINE_NUMBER_MODE;
  if (mode === 'ENFORCE') return { action: 'DEFER', reason: 'ENGINE_NUMBER_MISSING' };
  if (mode === 'LOG') {
    console.warn(
      `[JobCardEvolveSync] LOG job card ${row.id} reg=${row.registrationNo ?? ''} vin=${row.vin} ` +
      'has no engine number — RO CREATE would be DEFERRED under ENFORCE',
    );
  }
  // OFF: no log, no DB write, no blocking — byte-identical to current behaviour.
  return { action: 'PROCEED' };
}

// Deterministic per-job-card correlation ref (Evolve CRMReferenceNo is x(8)).
function deriveCrmRoRef(jobCardId: string): string {
  return jobCardId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

// Build a persistable, classified one-line message from an error that escaped
// the Evolve push (transport/timeout/HTTP). Reads the class/code tags set by
// the Evolve transport layer; safe to call on any error.
function classifyEscapedError(err: unknown): string {
  const e = err as { __evolveClass?: string; code?: unknown; message?: unknown; cause?: { code?: unknown } };
  const cls = e?.__evolveClass ?? 'TRANSPORT_ERROR';
  const code = e?.code ?? e?.cause?.code ?? '';
  const msg = e?.message ?? 'unknown';
  return `[${cls}${code ? '/' + String(code) : ''}] ${String(msg)}`.slice(0, 1000);
}

// Persist the labour-line identity onto each source item after a successful RO
// update, so a later edit re-sends the SAME Evolve line (LineStatus=U) instead
// of appending a duplicate. evolve_line_status='P' marks it posted. Best-effort:
// the RO already succeeded, so a bookkeeping miss must not fail the sync.
async function persistLabourLineBookkeeping(lines: ResolvedLabourLine[]): Promise<void> {
  for (const line of lines) {
    try {
      await db.update(jobCardItems)
        .set({ evolveLineNumber: Number(line.lineNumber), evolveLineStatus: 'P', updatedAt: new Date() })
        .where(eq(jobCardItems.id, line.itemId));
    } catch (persistErr) {
      console.error(`[JobCardEvolveSync] could not persist line bookkeeping for item ${line.itemId}:`, (persistErr as Error)?.message);
    }
  }
}

// Best-effort FAILED persistence — never throws (callers are fire-and-forget).
async function markJobCardSyncFailed(jobCardId: string, detail: string): Promise<void> {
  try {
    const [r] = await db
      .select({ a: jobCards.evolveAttemptCount })
      .from(jobCards)
      .where(eq(jobCards.id, jobCardId))
      .limit(1);
    await parkRetryable(jobCardId, r?.a ?? 0, 'FAILED', detail);
  } catch (persistErr) {
    console.error(`[JobCardEvolveSync] could not persist FAILED for ${jobCardId}:`, (persistErr as Error)?.message);
  }
}

function ddmmyyyy(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${mon}/${d.getFullYear()}`;
}

// Normalise a stored registration date to Evolve's dd/mm/yyyy.
//
// The loader already formats this column via to_char, so in practice only a
// string arrives. This stays defensive because the type drizzle infers for a
// `date` column (string) does NOT match what node-postgres hands back (a Date):
// if the to_char were ever dropped, a Date would reach here and a naive
// `.trim()` would throw TypeError inside buildRoInput — silently killing every
// RO create and update via the callers' catch blocks.
//
// Accepted inputs:
//   'DD/MM/YYYY'  → returned as-is (the to_char output)
//   'YYYY-MM-DD'  → reordered (ISO, e.g. a raw column read)
//   Date          → UTC accessors, so the result cannot shift by a day with the
//                   process timezone. NOTE: a Date produced by node-postgres for
//                   a `date` column is built at LOCAL midnight, so UTC accessors
//                   would report the PREVIOUS day west of Greenwich. That is
//                   precisely why the column is formatted in SQL instead — this
//                   branch is a guard against a crash, not a supported path.
// Anything else (null, undefined, blank, unparseable, Invalid Date) → null, so
// the caller omits the element rather than sending a blank one.
function isoToDdMmYyyy(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const d = String(value.getUTCDate()).padStart(2, '0');
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${value.getUTCFullYear()}`;
  }
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  const ddmmyyyyMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyyMatch) return s;
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return isoMatch ? `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}` : null;
}

// Authoritative local lifecycle (vehicle_check_ins.ro_status) → Evolve
// ROStatus/ROStatusType. Outbound mapping ONLY — never changes local status.
// Codes confirmed against this dealer's IRM_GetLookupDropdownTables (ROStatuses).
// Any unmapped/unknown state falls back to WIP/W (always accepted by Evolve).
const RO_STATUS_MAP: Record<string, { roStatus: string; roStatusType: string }> = {
  ARRIVED:           { roStatus: 'Booking',    roStatusType: 'B' },
  QC_CHECK_IN:       { roStatus: 'WIP',        roStatusType: 'W' },
  IN_WORKSHOP:       { roStatus: 'WIP',        roStatusType: 'W' },
  DIAGNOSING:        { roStatus: 'WIP',        roStatusType: 'W' },
  AWAITING_APPROVAL: { roStatus: 'Await Auth', roStatusType: 'W' },
  APPROVED:          { roStatus: 'WIP',        roStatusType: 'W' },
  WAITING_FOR_PARTS: { roStatus: 'Wait Parts', roStatusType: 'W' },
  REPAIRS_STARTED:   { roStatus: 'WIP',        roStatusType: 'W' },
  QC_OUT:            { roStatus: 'WIP',        roStatusType: 'W' },
  QC_FAILED:         { roStatus: 'WIP',        roStatusType: 'W' },
  QC_PASSED:         { roStatus: 'WIP',        roStatusType: 'W' },
  WASHBAY:           { roStatus: 'WIP',        roStatusType: 'W' },
  READY_FOR_RELEASE: { roStatus: 'Complete',   roStatusType: 'C' },
  RELEASED:          { roStatus: 'Complete',   roStatusType: 'C' },
  CLOSED:            { roStatus: 'Complete',   roStatusType: 'C' },
};
function mapRoStatus(roStatus: string | null): { roStatus: string; roStatusType: string } {
  return RO_STATUS_MAP[(roStatus ?? '').toUpperCase()] ?? { roStatus: 'WIP', roStatusType: 'W' };
}

interface JobCardSyncRow {
  id: string; status: string | null; totalEstimate: string | null; serviceType: string | null;
  jobType: string | null; // Evolve RO <JobType> code (AI-1); null → 'INT' default
  createdAt: Date; evolveRoNumber: string | null; evolveCrmRoRef: string | null;
  customerId: string; custSequenceId: string | null; vin: string; registrationNo: string | null;
  engineNumber: string | null; registrationYear: number | null; manufacturingYear: number | null; odometerLast: number | null;
  brand: string; model: string; modelCode: string | null;
  // Evolve-lookup vehicle attributes that the IRM_ROMaintenance contract
  // supports (<RegistrationDate>, <SellingDealer>). Persisted by
  // mapEvolveVehicleFields but previously not selected here, so buildRoInput
  // could not forward them.
  //
  // registrationDate is formatted to Evolve's dd/mm/yyyy by Postgres itself
  // (to_char in the projection below) and therefore arrives as a STRING. This is
  // deliberate: node-postgres parses a `date` column (OID 1082) into a JS Date
  // built at LOCAL midnight, so reading its calendar fields is timezone
  // dependent and drizzle's `date()` types it `string` while handing back a
  // Date. Formatting in SQL removes both hazards — a pg `date` carries no
  // timezone, so to_char is stable regardless of server or client TZ.
  registrationDate: string | null;
  sellingDealerCode: string | null;
  roStatus: string | null; // authoritative lifecycle (vehicle_check_ins.ro_status)
  // The customer's OWN reported complaint, captured at gate entry (and
  // auto-filled there from the booking's appointments.complaints). This is the
  // source for Evolve <CustomerStates>; the work/parts-derived text is NOT.
  complaintText: string | null;
  owningCompanyId: string | null; // authoritative vehicle ownership (Phase C)
  vehicleCheckInId: string | null; // for the appointment-snapshot fallback lookup
  serviceAdvisorNumber: number | null; // job-card creator's Evolve SANumber (Gap 4); null → '1' default
  evolveAttemptCount: number | null;
  // AI-3: Franchise / Service Dept from the job card's selected labeled pair
  // (franchise_service_departments via jobCards.franchiseServiceDeptId). Null
  // when nothing is selected → RO keeps the '1' / '1' default.
  franchiseSeqId: string | null;
  serviceDept: string | null;
}

async function loadJobCardForSync(jobCardId: string): Promise<JobCardSyncRow | null> {
  const [row] = await db
    .select({
      id: jobCards.id, status: jobCards.status, totalEstimate: jobCards.totalEstimate,
      serviceType: jobCards.serviceType, jobType: jobCards.jobType, createdAt: jobCards.createdAt,
      evolveRoNumber: jobCards.evolveRoNumber, evolveCrmRoRef: jobCards.evolveCrmRoRef,
      customerId: customers.id,
      custSequenceId: customers.custSequenceId,
      vin: vehicles.vin, registrationNo: vehicles.registrationNumber, engineNumber: vehicles.engineNumber,
      registrationYear: vehicles.registrationYear, manufacturingYear: vehicles.manufacturingYear, odometerLast: vehicles.odometerLast,
      brand: vehicles.brand, model: vehicles.model, modelCode: vehicles.modelCode,
      // Formatted in SQL to Evolve's dd/mm/yyyy — see JobCardSyncRow above for
      // why this must not come back as a JS Date. NULL stays NULL.
      registrationDate: sql<string | null>`to_char(${vehicles.registrationDate}, 'DD/MM/YYYY')`,
      sellingDealerCode: vehicles.sellingDealerCode,
      roStatus: vehicleCheckIns.roStatus,
      // Reuses the existing vehicleCheckIns left join below — no new join.
      complaintText: vehicleCheckIns.complaintText,
      owningCompanyId: vehicles.owningCompanyId,
      vehicleCheckInId: jobCards.vehicleCheckInId,
      serviceAdvisorNumber: users.evolveSaNumber,
      evolveAttemptCount: jobCards.evolveAttemptCount,
      // AI-3: Franchise / Service Dept from the job card's selected labeled pair.
      franchiseSeqId: franchiseServiceDepartments.franchiseSeqId,
      serviceDept: franchiseServiceDepartments.sdNumber,
    })
    .from(jobCards)
    .innerJoin(vehicles, eq(vehicles.id, jobCards.vehicleId))
    .innerJoin(customers, eq(customers.id, vehicles.customerId))
    .leftJoin(vehicleCheckIns, eq(vehicleCheckIns.id, jobCards.vehicleCheckInId))
    .leftJoin(users, eq(users.id, jobCards.createdBy))
    .leftJoin(
      franchiseServiceDepartments,
      eq(franchiseServiceDepartments.id, jobCards.franchiseServiceDeptId),
    )
    .where(eq(jobCards.id, jobCardId))
    .limit(1);
  return (row as JobCardSyncRow) ?? null;
}

// Resolve a job card's assigned items into Evolve labour lines (PostingType=L).
// I/O only: fetch the assigned items (joined to users for the mapped TechnicianNo,
// pre-ordered for stable line numbering) and hand the plain rows to the pure
// buildLabourLinesFromItems (unit-tested in evolveLabour.ts).
export async function resolveLabourLines(jobCardId: string): Promise<LabourLineResolution> {
  const rows = await db
    .select({
      id: jobCardItems.id,
      desc: jobCardItems.jobDescription,
      hoursWorked: jobCardItems.hoursWorked,
      hoursSold: jobCardItems.hoursSold,
      estimatedHours: jobCardItems.estimatedHours,
      jobGroup: jobCardItems.jobGroup,
      evolveLineNumber: jobCardItems.evolveLineNumber,
      evolveTechnicianNo: users.evolveTechnicianNo,
    })
    .from(jobCardItems)
    .leftJoin(users, eq(users.id, jobCardItems.assignedTechnicianId))
    .where(and(eq(jobCardItems.jobCardId, jobCardId), sql`${jobCardItems.assignedTechnicianId} IS NOT NULL`))
    .orderBy(jobCardItems.sortOrder, jobCardItems.id);

  return buildLabourLinesFromItems(rows as LabourItemRow[]);
}

// Resolve the Evolve InterfaceCode for this RO (Phase C), gated by
// EVOLVE_COMPANY_AWARE_PUSH. Resolution chain:
//   vehicles.owning_company_id (authoritative, common path)
//     → appointments.company_id (legacy fallback via jobCards.vehicleCheckInId
//       → appointments.check_in_id; separate query, NOT joined into the main load)
//     → null (undefined → XML builder falls back to env.EVOLVE_INTERFACE_CODE)
// All resolution goes through CompanyResolver; never queries `companies` directly.
// Never fails the sync — an unresolved company just yields undefined (env default).
async function resolveRoInterfaceCode(row: JobCardSyncRow): Promise<string | undefined> {
  if (!env.EVOLVE_COMPANY_AWARE_PUSH) return undefined; // flag off → today's behaviour exactly

  // 1) Authoritative: vehicle ownership. Common path — no logging.
  if (row.owningCompanyId) {
    const code = await companyResolver.resolveInterfaceCode(row.owningCompanyId);
    if (code) return code;
  }

  // 2) Legacy fallback: appointment snapshot, only when ownership is unresolved.
  if (row.vehicleCheckInId) {
    const [appt] = await db
      .select({ companyId: appointments.companyId })
      .from(appointments)
      .where(eq(appointments.checkInId, row.vehicleCheckInId))
      .limit(1);
    if (appt?.companyId) {
      const code = await companyResolver.resolveInterfaceCode(appt.companyId);
      if (code) {
        console.log(`[JobCardEvolveSync] job card ${row.id} interface code resolved via appointment snapshot (reason=OWNER_NULL_APPT_FALLBACK, companyId=${appt.companyId})`);
        return code;
      }
    }
  }

  // 3) Nothing resolved → env default (applied by the XML builder).
  console.warn(`[JobCardEvolveSync] job card ${row.id} interface code unresolved (reason=NO_COMPANY, owningCompanyId=${row.owningCompanyId ?? 'null'}) → using env default`);
  return undefined;
}

// Resolve the RO OwnerCustSequenceID (Phase D2 / ADR-002).
//   Flag ON  → per-company identity via the single resolver: the customer's id
//              in the vehicle's owning company (link → global fallback). source
//              'none' → '' (placeholder) so the caller DEFERs, exactly as today.
//   Flag OFF → today's behaviour: the global customers.cust_sequence_id.
async function resolveRoOwnerSeq(row: JobCardSyncRow): Promise<string> {
  if (env.EVOLVE_COMPANY_AWARE_PUSH && row.customerId) {
    const resolved = await resolveCustomerEvolveId(row.customerId, row.owningCompanyId);
    return resolved.custSequenceId ?? '';
  }
  return row.custSequenceId ?? '';
}

// Resolve the RO FranchiseSeqID / ServiceDept (AI-3) from the Franchise /
// Service-Dept pair the user selected on the job card (jobCards.franchiseServiceDeptId
// → franchise_service_departments, joined in loadJobCardForSync). This mirrors
// Evolve's two RO dropdowns and is the SOLE source — the former make-based
// auto-resolution has been replaced. When nothing is selected, return {} so the
// XML builder keeps its proven '1' / '1' default (byte-identical to before).
// Exported for unit testing; behaviour unchanged.
export async function resolveRoFranchise(
  row: JobCardSyncRow,
): Promise<{ franchiseSeqId?: string; serviceDept?: string }> {
  const franchiseSeqId = (row.franchiseSeqId ?? '').trim();
  const serviceDept = (row.serviceDept ?? '').trim();
  if (franchiseSeqId && serviceDept) {
    return { franchiseSeqId, serviceDept };
  }
  console.warn(
    `[JobCardEvolveSync] UNMAPPED_FRANCHISE job card ${row.id} — no Franchise/Service-Dept selected ` +
    `(make="${row.brand ?? ''}", vin=${row.vin ?? ''}, reg=${row.registrationNo ?? ''}) ` +
    `→ falling back to FranchiseSeqID/ServiceDept '1'`,
  );
  return {};
}

// Resolve the RO AppointmentDate from the REAL appointment linked to this job
// card's check-in (appointments.check_in_id → jobCards.vehicle_check_in_id).
// Returns 'DD/MM/YYYY' when an appointment exists; null otherwise so the caller
// falls back to the job-card createdAt exactly as before. Uses only the existing
// appointments.appointment_date column — no new source. Reformats the pg date
// string directly (no Date parsing) to avoid timezone day-shift.
// Resolve the RO <ServiceAdvisorNumber>. Preference order:
//   1. the SERVICE ADVISOR SELECTED ON THE APPOINTMENT (appointments.serviceAdvisorId
//      → users.evolve_sa_number), reached via the shared check-in;
//   2. the job-card creator's mapping (row.serviceAdvisorNumber, from createdBy);
//   3. null → the XML builder's '1' default.
// The appointment SA is authoritative because it is who the booking assigned to
// the job — the creator may be a different staff member.
async function resolveRoServiceAdvisorNumber(row: JobCardSyncRow): Promise<number | null> {
  if (row.vehicleCheckInId) {
    const [appt] = await db
      .select({ serviceAdvisorId: appointments.serviceAdvisorId })
      .from(appointments)
      .where(eq(appointments.checkInId, row.vehicleCheckInId))
      .orderBy(sql`${appointments.appointmentDate} desc`)
      .limit(1);
    if (appt?.serviceAdvisorId) {
      const [u] = await db
        .select({ evolveSaNumber: users.evolveSaNumber })
        .from(users)
        .where(eq(users.id, appt.serviceAdvisorId))
        .limit(1);
      if (u?.evolveSaNumber != null) return u.evolveSaNumber;
    }
  }
  // Fallback: job-card creator's mapping (existing behaviour), else null → '1'.
  return row.serviceAdvisorNumber ?? null;
}

async function resolveRoAppointmentDate(row: JobCardSyncRow): Promise<string | null> {
  if (!row.vehicleCheckInId) return null;
  const [appt] = await db
    .select({ appointmentDate: appointments.appointmentDate })
    .from(appointments)
    .where(eq(appointments.checkInId, row.vehicleCheckInId))
    .orderBy(sql`${appointments.appointmentDate} desc`)
    .limit(1);
  // appointments.appointment_date is a pg `date` → Drizzle returns 'YYYY-MM-DD'.
  const raw = appt?.appointmentDate;
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

// Resolve the RO <ServiceType> code from the service_types cache (Gap 3).
// The job card stores a service-type LABEL (or a comma-joined list of labels).
// We resolve a code ONLY when it maps unambiguously — a single (non-comma) value
// that exactly matches exactly one active service_types row (by code or name).
// Any ambiguity (empty / multi-value / no match / >1 distinct code) → undefined,
// so buildRoInput omits it and the XML keeps its proven 'S06' default. No
// guessing, no invented mappings — a pure exact lookup against the cache.
async function resolveServiceTypeCode(rawValue: string | null | undefined): Promise<string | undefined> {
  const value = (rawValue ?? '').trim();
  if (!value || value.includes(',')) return undefined;
  const matches = await db
    .select({ code: serviceTypes.code })
    .from(serviceTypes)
    .where(and(eq(serviceTypes.isActive, true), or(eq(serviceTypes.code, value), eq(serviceTypes.name, value))));
  const codes = Array.from(new Set(matches.map((m) => m.code).filter(Boolean)));
  return codes.length === 1 ? codes[0] : undefined;
}

async function resolveRoServiceType(row: JobCardSyncRow): Promise<string | undefined> {
  return resolveServiceTypeCode(row.serviceType);
}

// Build the RO payload from a loaded job-card row (shared by create + update).
// ownerSeq is resolved by the caller (resolveRoOwnerSeq) so the placeholder
// guard and the payload use the SAME value.
async function buildRoInput(row: JobCardSyncRow, roNumber: string, crmRef: string, modelCode: string, ownerSeq: string): Promise<RoMaintenanceInput> {
  // modelCode is decided by the caller's gateModelCode (catalog read-only, no
  // first-code fallback). buildRoInput only assembles the payload.
  const items = await db
    .select({
      desc: jobCardItems.jobDescription,
      partsRequired: jobCardItems.partsRequired,
      jobGroup: jobCardItems.jobGroup,
      jobType: jobCardItems.jobType,
      estimatedHours: jobCardItems.estimatedHours,
      serviceType: jobCardItems.serviceType,
      partsCost: jobCardItems.partsCost,
      labourCost: jobCardItems.labourCost,
      quantity: jobCardItems.quantity,
      // Per-job AR account → <ROJobHeader><ARAccountNo> (migration 0068).
      arAccountNo: jobCardItems.evolveArAccountNo,
    })
    .from(jobCardItems)
    .where(eq(jobCardItems.jobCardId, row.id))
    .orderBy(jobCardItems.jobGroup, jobCardItems.sortOrder);

  const nonLabour = (i: { partsRequired: string | null }) =>
    (i.partsRequired ?? '').toUpperCase() !== 'LABOUR';

  // Card-level CustomerStates/SAInstruction — the single-block behaviour used
  // when multi-job is off (unchanged from before).
  const states = (items
    .filter(nonLabour)
    .map((i) => i.desc)
    .filter(Boolean)
    .join('; ')
    .slice(0, 250)) || (row.serviceType ?? 'Service');

  // Evolve <CustomerStates> is the CUSTOMER's reported complaint, not the work
  // to be done. It was previously fed from `states` (the non-labour line-item
  // descriptions), which is the parts list — so Evolve showed parts where the
  // customer's request belongs.
  //
  // Falls back to `states` when no complaint was captured (vehicles that
  // entered without an appointment and with nothing typed at the gate), so the
  // field is never blank. The 250-cap is applied to the FINAL value so a long
  // free-text complaint is truncated the same way the old value was.
  //
  // <SAInstruction> deliberately keeps `states`: it is the advisor's
  // instruction covering the work/parts, a genuinely different field in the
  // Evolve contract. The two are no longer the same variable.
  const customerStates = (row.complaintText?.trim() || states).slice(0, 250);

  // Card-level AR account → <ARAccountNo> on the single-job block. Resolved
  // OUTSIDE the multi-job branch below on purpose: that branch only runs when
  // EVOLVE_RO_MULTI_JOB_ENABLED is on (default off), and without this the
  // operator's chosen account would be stored locally and never sent to Evolve.
  // First non-blank wins — all items of a job carry the same value.
  const cardArAccountNo = items.find((i) => (i.arAccountNo ?? '').trim())?.arAccountNo?.trim();

  // Multi-job (gated): group items by jobGroup → one ROJobHeader RowDetails per
  // job, each with its OWN CustomerStates/SAInstruction/ServiceType/estimate.
  // Off → jobs stays undefined and the XML builder emits the single block above.
  let jobs: RoJobHeaderJob[] | undefined;
  if (env.EVOLVE_RO_MULTI_JOB_ENABLED) {
    const groups = new Map<number, typeof items>();
    for (const it of items) {
      const g = it.jobGroup ?? 1;
      const arr = groups.get(g);
      if (arr) arr.push(it);
      else groups.set(g, [it]);
    }
    const built: RoJobHeaderJob[] = [];
    let jobNo = 1;
    for (const [, groupItems] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const jobStates = groupItems
        .filter(nonLabour)
        .map((i) => i.desc)
        .filter(Boolean)
        .join('; ')
        .slice(0, 250) || (groupItems[0]?.serviceType ?? 'Service');
      const jobEstimate = groupItems.reduce(
        (sum, i) => sum + (Number(i.partsCost) || 0) * (i.quantity ?? 1) + (Number(i.labourCost) || 0),
        0,
      );
      // Per-job Job Type: this job's own value, falling back to the card-level
      // one; the XML builder defaults to 'INT' when both are blank.
      const groupJobType = groupItems.find((i) => i.jobType)?.jobType ?? row.jobType ?? undefined;
      // Per-job SA hours estimate → <HoursEstimate>. All items of a job carry the
      // same value; take the first non-null.
      const groupHoursRaw = groupItems.find((i) => i.estimatedHours != null)?.estimatedHours;
      const groupHours = groupHoursRaw != null ? Number(groupHoursRaw) : null;
      // Per-job AR account → <ARAccountNo>. Selected on the job card when the
      // Job Type requires it; all items of a job carry the same value, so take
      // the first non-blank. Absent → the XML builder omits the element.
      const groupArAccountNo = groupItems.find((i) => (i.arAccountNo ?? '').trim())?.arAccountNo?.trim();
      built.push({
        jobNumber: String(jobNo).padStart(2, '0'),
        ...(groupJobType ? { jobType: groupJobType } : {}),
        ...(groupArAccountNo ? { arAccountNo: groupArAccountNo } : {}),
        ...(groupHours != null && Number.isFinite(groupHours) ? { hoursEstimate: groupHours.toFixed(2) } : {}),
        serviceType: await resolveServiceTypeCode(groupItems[0]?.serviceType),
        valueCpaEstimate: jobEstimate.toFixed(2),
        // Card-level complaint repeated on every job block — the complaint is a
        // property of the visit, not of an individual job, and no job-specific
        // complaint mapping exists. SAInstruction stays per-job work text.
        customerStates,
        saInstruction: jobStates,
      });
      jobNo += 1;
    }
    if (built.length) jobs = built;
  }

  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);

  // Prefer the real linked appointment date; fall back to job-card createdAt
  // (unchanged behaviour when the job card has no linked appointment).
  const appointmentDate = (await resolveRoAppointmentDate(row)) ?? ddmmyyyy(createdAt);

  // Company-aware InterfaceCode (Phase C). undefined → builder uses env default.
  const interfaceCode = await resolveRoInterfaceCode(row);

  // ServiceAdvisorNumber — the appointment-selected SA takes precedence over the
  // job-card creator (see resolveRoServiceAdvisorNumber).
  const serviceAdvisorNumber = await resolveRoServiceAdvisorNumber(row);

  // Franchise / ServiceDept (AI-3). Extension point — returns {} today, so both
  // fall through to the XML builder's proven '1' default. Populated only once
  // the client supplies the franchise mapping (see resolveRoFranchise).
  const { franchiseSeqId, serviceDept } = await resolveRoFranchise(row);

  // ServiceType (Gap 3). Resolved from the service_types cache when the job
  // card's label maps unambiguously to a code; undefined otherwise → 'S06'.
  const serviceTypeCode = await resolveRoServiceType(row);

  // Technician labour lines (ROJobDetails / PostingType=L). Gated by the dedicated
  // flag + schema probe so the feature ships dark and never affects RO sync when
  // disabled or when migration 0039 is absent. Unresolved items (unmapped tech /
  // missing hours) are logged here; the DEFER decision belongs to the sync caller.
  let jobDetails: RoJobDetailLine[] | undefined;
  if (env.EVOLVE_LABOUR_LINES_ENABLED && isEvolveLabourLinesReady()) {
    const resolution = await resolveLabourLines(row.id);
    if (resolution.lines.length) {
      jobDetails = resolution.lines.map(({ itemId: _itemId, ...line }) => line);
    }
    if (resolution.unresolved.length) {
      console.warn(
        `[JobCardEvolveSync] job card ${row.id}: ${resolution.unresolved.length} labour line(s) unresolved ` +
        `(${resolution.unresolved.map((u) => `${u.itemId}:${u.reason}`).join(', ')})`,
      );
    }
  }

  return {
    crmReferenceNo: crmRef,
    roNumber,
    ...(interfaceCode ? { interfaceCode } : {}),
    // AI-3: forwarded ONLY when a franchise mapping resolved a value; otherwise
    // omitted so the XML builder keeps <FranchiseSeqID>1</FranchiseSeqID> /
    // <ServiceDept>1</ServiceDept> exactly as today.
    ...(franchiseSeqId ? { franchiseSeqId } : {}),
    ...(serviceDept ? { serviceDept } : {}),
    // Gap 3: forwarded only when the service type resolved unambiguously from the
    // cache; otherwise omitted so the XML builder keeps <ServiceType>S06</ServiceType>.
    ...(serviceTypeCode ? { serviceType: serviceTypeCode } : {}),
    // AR account for the single-job block; the per-job value on `jobs` below
    // takes precedence when multi-job is enabled.
    ...(cardArAccountNo ? { arAccountNo: cardArAccountNo } : {}),
    ownerCustSequenceId: ownerSeq,
    vin: row.vin,
    registrationNo: row.registrationNo ?? '',
    engineNumber: normalizeEngineNumber(row.engineNumber),
    make: row.brand,
    modelCode,
    modelDescription: row.model,            // vehicles.model = Evolve ModelDescription
    modelYear: row.manufacturingYear ?? row.registrationYear ?? '',
    // Lookup-sourced vehicle attributes the RO contract supports. Forwarded
    // ONLY when populated, so a CREATE or UPDATE never sends a blank that could
    // overwrite a value Evolve already holds. Shared by both paths — CREATE and
    // UPDATE use this same builder.
    ...(isoToDdMmYyyy(row.registrationDate) ? { registrationDate: isoToDdMmYyyy(row.registrationDate)! } : {}),
    ...(row.sellingDealerCode?.trim() ? { sellingDealer: row.sellingDealerCode.trim() } : {}),
    odoIn: row.odometerLast ?? 0,
    appointmentDate,
    valueCpaEstimate: row.totalEstimate ?? '0',
    customerStates,
    saInstruction: states,
    // Multi-job (gated): when present, the XML builder emits one ROJobHeader
    // RowDetails per job and ignores the single customerStates/saInstruction above.
    ...(jobs ? { jobs } : {}),
    // Evolve RO Job Type (AI-1). Forwarded only when the job card carries a
    // code; when null (historical rows / not chosen) it is omitted so the XML
    // builder applies today's proven 'INT' default. No guessed value is ever
    // injected here — the code originates from the job_types lookup cache.
    ...(row.jobType ? { jobType: row.jobType } : {}),
    // Evolve ServiceAdvisorNumber (Gap 4). Forwarded only when the job card's
    // creator has a mapped Evolve SANumber; otherwise omitted so the XML builder
    // keeps the proven '1' default. No guessed value is injected.
    ...(serviceAdvisorNumber != null ? { serviceAdvisorNumber: String(serviceAdvisorNumber) } : {}),
    ...(jobDetails ? { jobDetails } : {}),
    // CREATE (blank RONumber) keeps the proven WIP/W unchanged; UPDATE maps the
    // authoritative vehicle_check_ins.ro_status to its Evolve ROStatus.
    ...(roNumber ? mapRoStatus(row.roStatus) : { roStatus: 'WIP', roStatusType: 'W' }),
  };
}

/**
 * CREATE path. Fire-and-forget; never throws.
 */
export async function syncJobCardToEvolveRo(jobCardId: string): Promise<void> {
  try {
    if (isEvolveSyncFrozen('create', jobCardId)) return; // full freeze — no CREATE at all
    if (!env.EVOLVE_JOB_CARD_SYNC_ENABLED) return; // feature flag — off by default
    if (!isEvolveJobCardSyncReady()) return; // schema gate (C4) — migrations absent

    const row = await loadJobCardForSync(jobCardId);
    if (!row) return;

    // Duplicate guard: a real RO number means it already exists in Evolve.
    if (row.evolveRoNumber) return;

    // Customer guard: RO requires a REAL OwnerCustSequenceID. Resolve the owner
    // id (per-company when the flag is on; global otherwise) and DEFER if it is
    // still a placeholder — including the resolver's source='none' case.
    const ownerSeq = await resolveRoOwnerSeq(row);
    if (isPlaceholderSeq(ownerSeq)) {
      await parkRetryable(jobCardId, row.evolveAttemptCount, 'DEFERRED', 'CUSTOMER_PLACEHOLDER');
      return;
    }

    // ModelCode guard (fail-closed under ENFORCE; observe-only under LOG/WARN).
    const gate = await gateModelCode(row);
    if (gate.action === 'MANUAL') {
      await parkManual(jobCardId, gate.reason ?? 'MODELCODE_MANUAL');
      console.warn(`[JobCardEvolveSync] job card ${jobCardId} → NEEDS_MANUAL: ${gate.reason}`);
      return;
    }
    if (gate.action === 'DEFER') {
      await parkRetryable(jobCardId, row.evolveAttemptCount, 'DEFERRED', gate.reason ?? 'MODELCODE_DEFER');
      console.log(`[JobCardEvolveSync] job card ${jobCardId} deferred: ${gate.reason}`);
      return;
    }

    // Mandatory-field guard: never call IRM_ROMaintenance with a missing VIN /
    // RegistrationNo / Make / ModelCode. Recoverable gaps (ModelCode) defer;
    // permanent gaps park for manual fix. See parkMissingMandatory.
    const missing = findMissingMandatoryFields(row, gate.modelCode);
    if (missing.length) {
      await parkMissingMandatory(jobCardId, row.evolveAttemptCount, missing, '');
      return;
    }

    // CRM-ref guard: generate + persist our correlation ref before the push.
    const crmRef = row.evolveCrmRoRef || deriveCrmRoRef(jobCardId);
    if (!row.evolveCrmRoRef) {
      await db.update(jobCards)
        .set({ evolveCrmRoRef: crmRef, evolveSyncStatus: 'PENDING', updatedAt: new Date() })
        .where(eq(jobCards.id, jobCardId));
    }

    // Duplicate-recovery (Gap 6): on a RETRY, a prior CREATE may have committed
    // in Evolve but lost its HTTP response. Before creating again, look up RO
    // history by VIN + CustSequenceID (+ a date window bracketing this job card)
    // and adopt any RO already carrying our CRMReferenceNo (the Integration ID) —
    // switching CREATE → UPDATE, never producing a duplicate. First attempts skip
    // this (no prior RO can exist yet). ROHistory failures degrade to CREATE.
    if ((row.evolveAttemptCount ?? 0) > 0) {
      const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      const interfaceCode = await resolveRoInterfaceCode(row);
      const history = await lookupRoHistory({
        vin: row.vin,
        custSequenceId: ownerSeq,
        registrationNo: row.registrationNo ?? undefined,
        dateRangeFrom: ddmmyyyy(createdAt),
        dateRangeTo: ddmmyyyy(new Date()),
        interfaceCode,
      });
      // Lookup could not be answered authoritatively → we cannot rule out that a
      // prior attempt already committed this RO. Do NOT CREATE (that would risk a
      // duplicate); defer via the normal retry mechanism and try again later.
      if (!history.ok) {
        await parkRetryable(jobCardId, row.evolveAttemptCount, 'DEFERRED', 'ROHISTORY_UNAVAILABLE');
        console.warn(`[JobCardEvolveSync] job card ${jobCardId} RO history lookup unavailable on retry — deferring to avoid a duplicate CREATE`);
        return;
      }
      const adopted = history.entries.find((h) => h.crmReferenceNo && h.crmReferenceNo === crmRef && h.roNumber);
      if (adopted?.roNumber) {
        await db.update(jobCards)
          .set({ evolveRoNumber: adopted.roNumber, evolveLastError: null, updatedAt: new Date() })
          .where(eq(jobCards.id, jobCardId));
        console.log(`[JobCardEvolveSync] job card ${jobCardId} adopted existing RONumber=${adopted.roNumber} via ROHistory (duplicate-recovery); switching to UPDATE`);
        await syncJobCardUpdateToEvolve(jobCardId); // CREATE → UPDATE with current data
        return;
      }
    }

    // Engine-number gate — LAST check before the CREATE payload is built, so
    // the duplicate-recovery adoption above always gets its chance first: a
    // prior CREATE whose HTTP response was lost must still be adopted, never
    // left orphaned in Evolve behind a deferred job card.
    const engineGate = gateEngineNumberForCreate(row);
    if (engineGate.action === 'DEFER') {
      await parkSoftDefer(jobCardId, engineGate.reason);
      console.warn(
        `[JobCardEvolveSync] job card ${jobCardId} CREATE deferred: ${engineGate.reason} ` +
        `(reg=${row.registrationNo ?? ''}) — no Evolve call, no attempt consumed`,
      );
      return;
    }

    const input = await buildRoInput(row, '', crmRef, gate.modelCode, ownerSeq); // blank RONumber = CREATE
    const result = await roMaintenance(input);

    if (result.success && result.roNumber) {
      await db.update(jobCards)
        .set({ evolveRoNumber: result.roNumber, evolveSyncStatus: 'SYNCED', evolveSyncedAt: new Date(), evolveLastError: null, evolveAttemptCount: 0, evolveNextAttemptAt: null, updatedAt: new Date() })
        .where(eq(jobCards.id, jobCardId));
      console.log(`[JobCardEvolveSync] job card ${jobCardId} synced — RONumber=${result.roNumber}`);
    } else {
      await parkRetryable(jobCardId, row.evolveAttemptCount, 'FAILED', result.message ?? 'unknown');
      console.warn(`[JobCardEvolveSync] job card ${jobCardId} RO create NOT successful: ${result.message}`);
    }
  } catch (err) {
    const detail = classifyEscapedError(err);
    console.error(`[JobCardEvolveSync] create for ${jobCardId} failed: ${detail}`);
    await markJobCardSyncFailed(jobCardId, detail);
  }
}

/**
 * UPDATE path. Routes to CREATE when no RO exists yet. Never throws.
 */
export async function syncJobCardUpdateToEvolve(jobCardId: string): Promise<void> {
  try {
    if (isEvolveSyncFrozen('update', jobCardId)) return; // full freeze
    if (!env.EVOLVE_JOB_CARD_SYNC_ENABLED) return; // feature flag — off by default
    if (!isEvolveJobCardSyncReady()) return; // schema gate (C4) — migrations absent

    const row = await loadJobCardForSync(jobCardId);
    if (!row) return;

    // Not created yet → CREATE (do NOT send a blank RONumber as a 2nd create).
    if (!row.evolveRoNumber) { await syncJobCardToEvolveRo(jobCardId); return; }

    const crmRef = row.evolveCrmRoRef || deriveCrmRoRef(jobCardId);

    // ModelCode guard (same fail-closed semantics as CREATE).
    const gate = await gateModelCode(row);
    if (gate.action === 'MANUAL') {
      await parkManual(jobCardId, gate.reason ?? 'MODELCODE_MANUAL');
      console.warn(`[JobCardEvolveSync] job card ${jobCardId} update → NEEDS_MANUAL: ${gate.reason}`);
      return;
    }
    if (gate.action === 'DEFER') {
      await parkRetryable(jobCardId, row.evolveAttemptCount, 'DEFERRED', gate.reason ?? 'MODELCODE_DEFER');
      return;
    }

    // Mandatory-field guard: never call IRM_ROMaintenance with a missing VIN /
    // RegistrationNo / Make / ModelCode. Recoverable gaps (ModelCode) defer;
    // permanent gaps park for manual fix. See parkMissingMandatory.
    const missing = findMissingMandatoryFields(row, gate.modelCode);
    if (missing.length) {
      await parkMissingMandatory(jobCardId, row.evolveAttemptCount, missing, ' update');
      return;
    }

    // Labour lines: resolve once for (a) the unresolved gate and (b) bookkeeping
    // persistence on success. Any unresolved item (unmapped technician or missing
    // hours) DEFERS the whole card — we never post a partial labour set or a
    // blank/zero TechNo. The operator fixes the mapping/hours; reconcile retries.
    let labourLines: ResolvedLabourLine[] = [];
    if (env.EVOLVE_LABOUR_LINES_ENABLED && isEvolveLabourLinesReady()) {
      const resolution = await resolveLabourLines(jobCardId);
      if (resolution.unresolved.length) {
        const reason = `LABOUR_UNRESOLVED: ${resolution.unresolved.map((u) => `${u.itemId}:${u.reason}`).join(', ')}`;
        await parkRetryable(jobCardId, row.evolveAttemptCount, 'DEFERRED', reason);
        console.warn(`[JobCardEvolveSync] job card ${jobCardId} update DEFERRED — ${reason}`);
        return;
      }
      labourLines = resolution.lines;
    }

    const ownerSeq = await resolveRoOwnerSeq(row);
    const input = await buildRoInput(row, row.evolveRoNumber, crmRef, gate.modelCode, ownerSeq); // populated RONumber = UPDATE
    const result = await roMaintenance(input);

    if (result.success) {
      if (labourLines.length) await persistLabourLineBookkeeping(labourLines);
      await db.update(jobCards)
        .set({ evolveSyncStatus: 'SYNCED', evolveSyncedAt: new Date(), evolveLastError: null, evolveAttemptCount: 0, evolveNextAttemptAt: null, updatedAt: new Date() })
        .where(eq(jobCards.id, jobCardId));
      console.log(`[JobCardEvolveSync] job card ${jobCardId} RO ${row.evolveRoNumber} updated${labourLines.length ? ` (${labourLines.length} labour line(s))` : ''}`);
    } else {
      await parkRetryable(jobCardId, row.evolveAttemptCount, 'FAILED', result.message ?? 'unknown');
      console.warn(`[JobCardEvolveSync] job card ${jobCardId} RO update NOT successful: ${result.message}`);
    }
  } catch (err) {
    const detail = classifyEscapedError(err);
    console.error(`[JobCardEvolveSync] update for ${jobCardId} failed: ${detail}`);
    await markJobCardSyncFailed(jobCardId, detail);
  }
}

/**
 * Reconciliation sweep — retries deferred/failed job cards whose backoff window
 * has elapsed. Routes by RO state:
 *   • no RO number yet      → CREATE  (e.g. customer synced after card creation)
 *   • RO exists but FAILED/DEFERRED → UPDATE (e.g. a failed/deferred labour push,
 *     such as a technician that was unmapped at allocation time and has since
 *     been mapped). Without this, a failed labour UPDATE would never auto-retry.
 * Sequential to avoid hammering Evolve. Dormant unless the flag is on. Never throws.
 */
export async function reconcileUnsyncedJobCards(limit = 50): Promise<{ scanned: number }> {
  try {
    if (isEvolveSyncFrozen('reconcile')) return { scanned: 0 }; // full freeze — sweep does nothing
    if (!env.EVOLVE_JOB_CARD_SYNC_ENABLED) return { scanned: 0 };
    if (!isEvolveJobCardSyncReady()) return { scanned: 0 }; // schema gate (C4)

    const rows = await db
      .select({ id: jobCards.id, roNumber: jobCards.evolveRoNumber })
      .from(jobCards)
      .where(
        and(
          // NEEDS_MANUAL is intentionally excluded (terminal until re-queued).
          sql`(${jobCards.evolveSyncStatus} IS NULL OR ${jobCards.evolveSyncStatus} IN ('FAILED','DEFERRED','PENDING'))`,
          // Respect exponential backoff: only pick rows whose window has elapsed.
          sql`(${jobCards.evolveNextAttemptAt} IS NULL OR ${jobCards.evolveNextAttemptAt} <= now())`,
        ),
      )
      .limit(limit);

    for (const r of rows) {
      // Both paths are idempotent and re-guard internally.
      if (r.roNumber) await syncJobCardUpdateToEvolve(r.id); // retry failed/deferred UPDATE (incl. labour)
      else await syncJobCardToEvolveRo(r.id);                // first-time CREATE
    }
    if (rows.length) console.log(`[JobCardEvolveSync] reconciliation swept ${rows.length} job card(s)`);
    return { scanned: rows.length };
  } catch (err) {
    console.error('[JobCardEvolveSync] reconcile failed:', (err as Error)?.message);
    return { scanned: 0 };
  }
}
