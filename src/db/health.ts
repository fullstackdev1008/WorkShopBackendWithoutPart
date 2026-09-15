/**
 * Migration-readiness gate for the Evolve ModelCode / RO-sync feature (C4).
 *
 * The feature touches schema added by migrations 0028 (catalog), 0035 (job-card
 * evolve_* columns), 0037 (NEEDS_MANUAL enum value) and 0038 (retry columns).
 * If any are missing, the RO-sync path would throw per-card. We probe the live
 * schema once at startup, cache the result, and let callers self-disable instead
 * of crash-looping. Never throws.
 */
import { sql } from 'drizzle-orm';
import { db } from './index';

let jobCardSyncReady = false;
let modelCatalogReady = false;
let labourLinesReady = false;
let checked = false;

export function isEvolveJobCardSyncReady(): boolean { return jobCardSyncReady; }
export function isModelCatalogReady(): boolean { return modelCatalogReady; }
export function isEvolveLabourLinesReady(): boolean { return labourLinesReady; }
export function evolveReadinessChecked(): boolean { return checked; }

async function rowsLen(query: ReturnType<typeof sql>): Promise<number> {
  const r = (await db.execute(query)) as unknown as { rows?: unknown[] };
  return r?.rows?.length ?? (Array.isArray(r) ? (r as unknown[]).length : 0);
}

async function tableExists(name: string): Promise<boolean> {
  return (await rowsLen(
    sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${name} LIMIT 1`,
  )) > 0;
}

async function columnExists(table: string, col: string): Promise<boolean> {
  return (await rowsLen(
    sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${col} LIMIT 1`,
  )) > 0;
}

async function enumHasValue(enumName: string, value: string): Promise<boolean> {
  return (await rowsLen(
    sql`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = ${enumName} AND e.enumlabel = ${value} LIMIT 1`,
  )) > 0;
}

export interface EvolveReadiness {
  jobCardSyncReady: boolean;
  modelCatalogReady: boolean;
  labourLinesReady: boolean;
  missing: string[];
}

/** Probe the schema, cache the flags, and return what (if anything) is missing. */
export async function checkEvolveReadiness(): Promise<EvolveReadiness> {
  const missing: string[] = [];
  try {
    const [makes, models, codes] = await Promise.all([
      tableExists('vehicle_makes'),
      tableExists('vehicle_models'),
      tableExists('vehicle_model_codes'),
    ]);
    modelCatalogReady = makes && models && codes;
    if (!makes) missing.push('table vehicle_makes');
    if (!models) missing.push('table vehicle_models');
    if (!codes) missing.push('table vehicle_model_codes (migration 0028)');

    const [roNo, status, attempt, nextAt] = await Promise.all([
      columnExists('job_cards', 'evolve_ro_number'),
      columnExists('job_cards', 'evolve_sync_status'),
      columnExists('job_cards', 'evolve_attempt_count'),
      columnExists('job_cards', 'evolve_next_attempt_at'),
    ]);
    const needsManual = await enumHasValue('evolve_sync_status', 'NEEDS_MANUAL');
    jobCardSyncReady = roNo && status && attempt && nextAt && needsManual;
    if (!roNo) missing.push('column job_cards.evolve_ro_number (migration 0035)');
    if (!status) missing.push('column job_cards.evolve_sync_status (migration 0035)');
    if (!attempt) missing.push('column job_cards.evolve_attempt_count (migration 0038)');
    if (!nextAt) missing.push('column job_cards.evolve_next_attempt_at (migration 0038)');
    if (!needsManual) missing.push("enum evolve_sync_status value 'NEEDS_MANUAL' (migration 0037)");

    // Labour-line allocation (migration 0039). Gated separately from the RO-sync
    // flag so labour emission can self-disable without affecting RO create/update
    // when its columns are absent.
    const [techNo, hoursWorked, hoursSold, lineNo, lineStatus] = await Promise.all([
      columnExists('users', 'evolve_technician_no'),
      columnExists('job_card_items', 'hours_worked'),
      columnExists('job_card_items', 'hours_sold'),
      columnExists('job_card_items', 'evolve_line_number'),
      columnExists('job_card_items', 'evolve_line_status'),
    ]);
    labourLinesReady = techNo && hoursWorked && hoursSold && lineNo && lineStatus;
    if (!techNo) missing.push('column users.evolve_technician_no (migration 0039)');
    if (!hoursWorked) missing.push('column job_card_items.hours_worked (migration 0039)');
    if (!hoursSold) missing.push('column job_card_items.hours_sold (migration 0039)');
    if (!lineNo) missing.push('column job_card_items.evolve_line_number (migration 0039)');
    if (!lineStatus) missing.push('column job_card_items.evolve_line_status (migration 0039)');
  } catch (err) {
    // Probe failure → treat as not-ready (fail-safe, never crash startup).
    jobCardSyncReady = false;
    modelCatalogReady = false;
    labourLinesReady = false;
    missing.push(`readiness probe failed: ${(err as Error)?.message}`);
  }
  checked = true;
  return { jobCardSyncReady, modelCatalogReady, labourLinesReady, missing };
}
