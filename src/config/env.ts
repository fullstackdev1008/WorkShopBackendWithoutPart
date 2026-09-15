import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('3000')
    .transform((v) => parseInt(v, 10)),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Server-side only — powers the Gate Entry vision scans (plate / licence /
  // odometer). Optional so the app still boots without it; the vision services
  // throw a clear configuration error only when a scan is actually requested.
  OPENAI_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().default('workshop-jwt-secret-change-in-production'),
  // Optional dedicated secret for encrypting stored settings secrets (SMTP
  // password). Falls back to JWT_SECRET when unset (see shared/security/crypto).
  SETTINGS_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional().default('587').transform((v) => parseInt(v, 10)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_FILE_SIZE: z
    .string()
    .default('10485760')
    .transform((v) => parseInt(v, 10)),
  USE_LOCAL_STORAGE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  FILE_PATH: z.string().default(''), // Base URL for accessing uploaded files (when using local storage)
  AWS_S3_BUCKET: z.string().default(''),
  AWS_S3_REGION: z.string().default('ap-south-1'),
  AWS_S3_ENDPOINT: z.string().default(''),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),

  // When true, the full Evolve master-data sync runs on every server startup
  // (one IRM_GetSeriesData call per make). Default off — sync on demand via
  // POST /api/sync/master-data instead, so restarts stay quiet.
  SYNC_ON_STARTUP: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // Evolve IRM (third-party vehicle lookup)
  EVOLVE_API_URL: z.string().default('https://intu.automate.co.za/wsesIRM/Service.asmx/EvolveRequestAction'),
  EVOLVE_INTERFACE_CODE: z.string().default('95112-ELT-70EC'),
  EVOLVE_SOURCE_SYSTEM: z.string().default('Evolve'),
  EVOLVE_TARGET_SYSTEM: z.string().default('WMS'),
  EVOLVE_MESSAGE_CREATOR: z.string().default('WMS'),
  // Country dialling code stripped from a leading international phone number
  // before Evolve normalisation. Default '27' (South Africa) preserves existing
  // behaviour; set per deployment (e.g. '971' for UAE).
  EVOLVE_PHONE_COUNTRY_CODE: z.string().default('27'),
  // Per-request HTTP timeout (ms) for every Evolve POST. Raised from the old
  // hardcoded 60s: RO Maintenance occasionally exceeds 60s under load, and a
  // timed-out CREATE that Evolve actually committed leaves a lost-response /
  // duplicate-RO ambiguity. 120s gives slow responses room to land.
  EVOLVE_HTTP_TIMEOUT_MS: z.string().default('120000').transform((v) => parseInt(v, 10)),
  // Master switch for pushing locally-created customers to Evolve
  // (IRM_CustomerMaintenance). OFF by default — the async sync plumbing is
  // wired but dormant until Phases 4–5 (in-place write-back + dup protection)
  // are complete and the envelope is confirmed against UAT.
  EVOLVE_CUSTOMER_SYNC_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Phase C master switch: resolve the Evolve InterfaceCode per-company for
  // customer + RO pushes (from vehicle/link ownership) instead of always using
  // EVOLVE_INTERFACE_CODE. OFF by default — when off, both pushes use the env
  // default exactly as today. Flip on to make pushes company-aware.
  EVOLVE_COMPANY_AWARE_PUSH: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Phase D master switch: enforce multi-company rules at create time — require
  // a company when creating a new customer/vehicle via the appointment wizard,
  // and block reusing/creating a vehicle owned by another company. OFF by
  // default → creation behaves exactly as today. Independent of
  // EVOLVE_COMPANY_AWARE_PUSH (outbound) so enforcement can be rolled out
  // separately from company-aware pushes.
  EVOLVE_MULTI_COMPANY_ENFORCEMENT: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Master switch for pushing locally-created job cards to Evolve
  // (IRM_ROMaintenance). OFF by default — the scaffolding is wired but the
  // actual RO push is intentionally NOT implemented: it is blocked on UAT
  // (vehicle pre-existence + Make/Model/SA/Status code mappings). See
  // jobCardEvolveSync.service.ts. Leaving this false keeps the feature inert.
  EVOLVE_JOB_CARD_SYNC_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Emit technician labour lines (ROJobDetails / PostingType=L) inside the RO
  // UPDATE payload. OFF by default and independent of the master sync flag so it
  // can ship dark: enable only after technicians have been mapped to their
  // Evolve TechnicianNo (admin Technician Mapping) and migration 0039 is applied.
  // Also gated at runtime by isEvolveLabourLinesReady() (schema probe).
  EVOLVE_LABOUR_LINES_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // FULL job-card Evolve freeze. When true, NOTHING is sent to Evolve for a job
  // card at any point in its lifecycle — no CREATE (so a newly created job card
  // never appears in Evolve at all), no UPDATE, no RO status progression, no
  // labour lines, no duplicate-recovery lookup, no reconcile-cron traffic.
  // The local job-card workflow is untouched; only the outbound sync stops.
  //
  // Enforced at the three exported entry points of jobCardEvolveSync.service.ts
  // AND as a hard backstop inside the RO calls in evolveIrm.service.ts, so no
  // present or future caller can reach Evolve while it is on.
  //
  // OFF by default → existing behaviour is unchanged until explicitly enabled.
  EVOLVE_SYNC_FREEZE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Verbose Evolve transport diagnostics. OFF by default. When 'true', the
  // Evolve HTTP layer logs the outbound SOAP XML, response status, response
  // headers, and response body — all PII-redacted (logging only; payloads are
  // never altered). Leave OFF in normal operation; enable during a UAT window.
  EVOLVE_DEBUG_LOG: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // ── ModelCode enforcement for RO sync (staged rollout) ───────────────────────
  //   OFF     — feature inert (default); legacy passthrough (a blank ModelCode
  //             may be sent). Fail-OPEN by design.
  //   LOG     — resolve READ-ONLY from the local catalog and log the decision;
  //             zero Evolve traffic, zero writes; blank still sent (shadow).
  //   WARN    — like LOG but warns on low confidence; blank still sent (shadow).
  //   ENFORCE — fail-CLOSED GUARANTEE: an RO is sent ONLY with a non-blank
  //             ModelCode (a stored code, or a HIGH-confidence catalog resolve);
  //             otherwise the RO is DEFERRED (retry w/ backoff) or routed to
  //             NEEDS_MANUAL. Unconditional — it is NOT downgraded by any other
  //             flag. Set ENFORCE in production for the no-blank-ModelCode guarantee.
  EVOLVE_MODELCODE_MODE: z
    .enum(['OFF', 'LOG', 'WARN', 'ENFORCE'])
    .default('OFF'),
  // Engine-number gate for RO CREATE. On CREATE (blank RONumber) Evolve
  // auto-creates the vehicle master from our payload, so a missing engine
  // number is written into Evolve's vehicle record permanently — and Evolve
  // then refuses to load a labour line under Cost Jobs (observed: RO FO008450 /
  // reg KFT69FYGP, 2026-09-08). Deferring costs a delayed mirror; proceeding
  // costs a broken vehicle in the DMS that no later sync reliably repairs.
  //   OFF     — no gate (current behaviour; byte-identical outbound payload)
  //   LOG     — log what WOULD be deferred, then proceed
  //   ENFORCE — fail-closed: a CREATE with no engine number is soft-DEFERRED
  // Mirrors EVOLVE_MODELCODE_MODE minus WARN: WARN there is a fail-open shadow
  // mode that already caused one hole, and LOG gives the same observability.
  // NEVER substitutes a value in any mode — see normalizeEngineNumber.
  EVOLVE_ENGINE_NUMBER_MODE: z
    .enum(['OFF', 'LOG', 'ENFORCE'])
    .default('OFF'),
  // Operational sign-off marker: set true once Evolve's blank/omitted-field
  // semantics for vehicle-identity UPDATEs are confirmed in UAT (C5/H5).
  // Surfaced in GET /api/sync/evolve-health (identityUpdateVerified). NOTE: this
  // no longer gates ENFORCE — fail-closed ModelCode behaviour is unconditional.
  EVOLVE_IDENTITY_UPDATE_VERIFIED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // RO sync retry/backoff (exponential): base delay, cap, and max attempts
  // before a retryable failure is parked as NEEDS_MANUAL.
  EVOLVE_RO_RETRY_BASE_MS: z.string().default('900000').transform((v) => parseInt(v, 10)),   // 15m
  EVOLVE_RO_RETRY_CAP_MS: z.string().default('14400000').transform((v) => parseInt(v, 10)),  // 4h
  EVOLVE_RO_MAX_ATTEMPTS: z.string().default('6').transform((v) => parseInt(v, 10)),
  // Out-of-band catalog warm job (Make→Series→ModelCode population). NEVER runs
  // inside the RO sync path; the resolver itself is always read-only.
  EVOLVE_CATALOG_WARM_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  EVOLVE_CATALOG_WARM_TTL_MS: z.string().default('86400000').transform((v) => parseInt(v, 10)), // 24h
  // Part search via Evolve IRM_PartInfoLookup. OFF by default — when off,
  // GET /api/parts/search behaves exactly as today (local parts_master only).
  // When on, an EXACT part-number lookup is tried against Evolve first, then the
  // local table is used as a fallback (both on "not found" and on any Evolve
  // outage). No part data is ever written to the local DB.
  EVOLVE_PART_SEARCH_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // RequestInfo values sent with IRM_PartInfoLookup. Defaults match the values
  // proven in the apitest harness (Type=CST, ServiceDepartment=01). Configurable
  // per deployment so they are never hardcoded/guessed in code.
  EVOLVE_PART_LOOKUP_TYPE: z.string().default('CST'),
  EVOLVE_PART_LOOKUP_SERVICE_DEPT: z.string().default('01'),
  // Emit one <ROJobHeader><RowDetails> per job (grouped by job_card_items.job_group)
  // instead of merging every item's description into a single block. OFF by
  // default: the multi-job structure follows the IRM spec's "repeat data →
  // RowDetails" convention but is not shown in any sample, so it must be verified
  // in UAT before enabling. When off, RO sync behaves exactly as today.
  EVOLVE_RO_MULTI_JOB_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
