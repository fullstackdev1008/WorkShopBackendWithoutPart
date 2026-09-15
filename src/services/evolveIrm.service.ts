import { v4 as uuidv4 } from 'uuid';
import { XMLParser } from 'fast-xml-parser';
import { env } from '../config/env';
import { renderRoJobDetailsXml, type RoJobDetailLine } from './evolveLabour';

// ─── XML Parser (same config as apitest) ─────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes:     false,
  attributeNamePrefix:  '@_',
  textNodeName:         '#text',
  parseAttributeValue:  true,
  trimValues:           true,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Flatten a parsed XML object — convert every leaf value to a string.
 * Handles fast-xml-parser's textNodeName='#text' pattern (tag with attributes
 * becomes { '@_attr': '...', '#text': value }).
 */
function flattenToStrings(obj: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('@_')) continue; // skip attribute-only keys at top level
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      // Tag with attributes: { '@_attr': '...', '#text': actualValue }
      const text = (value as any)['#text'];
      if (text !== null && text !== undefined) {
        result[key] = String(text).trim();
      }
    } else {
      result[key] = String(value).trim();
    }
  }
  return result;
}

// ─── Transport diagnostics, classification & redaction ──────────────────────────

export type EvolveErrorClass =
  | 'TRANSPORT_ERROR'
  | 'TIMEOUT_ERROR'
  | 'HTTP_ERROR'
  | 'SOAP_FAULT'
  | 'BUSINESS_VALIDATION_ERROR';

// Connection-level codes that are safe to retry within the existing attempt
// budget (undici socket/abort codes + classic POSIX network codes).
const TRANSIENT_TRANSPORT_CODES = new Set([
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

// Collect the codes/names off an error and its undici `cause` for inspection.
function errorCodes(err: unknown): string[] {
  const e = err as { code?: unknown; name?: unknown; cause?: { code?: unknown; name?: unknown } };
  return [e?.code, e?.name, e?.cause?.code, e?.cause?.name]
    .filter((v) => v !== undefined && v !== null)
    .map(String);
}

function isTransientTransportError(err: unknown): boolean {
  return errorCodes(err).some((c) => TRANSIENT_TRANSPORT_CODES.has(c));
}

function classifyTransportError(err: unknown): 'TRANSPORT_ERROR' | 'TIMEOUT_ERROR' {
  const codes = errorCodes(err);
  if (codes.includes('TimeoutError') || codes.includes('AbortError')) return 'TIMEOUT_ERROR';
  if (codes.includes('ETIMEDOUT') || codes.includes('UND_ERR_HEADERS_TIMEOUT')) return 'TIMEOUT_ERROR';
  return 'TRANSPORT_ERROR';
}

// Flat, log-safe view of an error including its undici `cause`.
function describeError(err: unknown): Record<string, unknown> {
  const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: { name?: unknown; message?: unknown; code?: unknown } };
  return {
    name:         e?.name,
    message:      e?.message,
    code:         e?.code,
    causeName:    e?.cause?.name,
    causeMessage: e?.cause?.message,
    causeCode:    e?.cause?.code,
  };
}

// Classify a parsed (HTTP-200) Evolve response that did NOT succeed.
function classifyEvolveResult(requestStatus: string | null, rowStatus: string | null): EvolveErrorClass {
  if (!requestStatus || requestStatus.toLowerCase() === 'failed') return 'SOAP_FAULT';
  return 'BUSINESS_VALIDATION_ERROR';
}

// HTTP non-2xx error, tagged so the sync layer can persist its class.
function httpError(label: string, status: number, body: string): Error {
  const err = new Error(`Evolve ${label} HTTP ${status}: ${body}`);
  (err as { __evolveClass?: EvolveErrorClass }).__evolveClass = 'HTTP_ERROR';
  return err;
}

// ── Redaction (logging only — never mutates the payload that is sent) ──────────
const REDACT_TAGS = [
  // 'IDNumber',
  'PassportNumber',
  // 'PrimaryEmail',
  // 'SecondaryEmail',
  // 'CellphoneNumber',
  // 'VehVinNumber',
  // InterfaceCode is not PII — kept unredacted so the per-company code is
  // visible in logs for debugging.
];

function maskValue(raw: string): string {
  const t = raw.trim();
  if (!t) return raw;                 // keep empty tags as-is
  if (t.length <= 4) return '***';
  return `***${t.slice(-2)}`;         // keep last 2 chars for correlation
}

function redactXml(xml: string): string {
  let out = xml;
  for (const tag of REDACT_TAGS) {
    const re = new RegExp(`(<${tag}>)([\\s\\S]*?)(</${tag}>)`, 'gi');
    out = out.replace(re, (_m, open, val, close) => `${open}${maskValue(String(val))}${close}`);
  }
  // Belt-and-suspenders: mask any stray email addresses anywhere in the body.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***');
  return out;
}

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = /authorization|cookie/i.test(key) ? '***' : value;
  });
  return out;
}

/**
 * Hard backstop for EVOLVE_SYNC_FREEZE — covers every Evolve WRITE:
 * IRM_ROMaintenance, IRM_CustomerMaintenance and the RO-history lookup used by
 * duplicate recovery.
 *
 * The freeze is enforced first at the service entry points (job-card sync and
 * customer sync), which return quietly and leave the record untouched. This is
 * the second line: it sits on the write calls themselves, so a NEW code path
 * that reaches them without going through those entry points cannot silently
 * send data to Evolve.
 *
 * READ-ONLY lookups (customer/vehicle search, part info, master data) are
 * deliberately NOT gated — they fetch reference data and never mutate Evolve.
 *
 * It throws rather than returning a fake result: reaching here while frozen is
 * a bug, and every caller already wraps these in try/catch that logs and parks
 * the record, so it degrades safely instead of taking a request down.
 */
function assertEvolveWriteAllowed(fn: string): void {
  if (env.EVOLVE_SYNC_FREEZE) {
    throw new Error(
      `[IRM] BLOCKED: ${fn} attempted while EVOLVE_SYNC_FREEZE is on. ` +
        'No job-card data may be sent to Evolve. This call bypassed the sync-service freeze guard.',
    );
  }
}

// Single choke-point for every Evolve POST: optional redacted debug logging,
// always-on transport-error classification, and a normalised result. Throws on
// transport failure (tagged via classifyTransportError); returns the raw body +
// status/headers on any HTTP response so callers keep their own ok/retry logic.
async function evolveHttpPost(
  xmlRequest: string,
  label: string,
): Promise<{ status: number; headers: Headers; body: string }> {
  if (env.EVOLVE_DEBUG_LOG) {
    console.log(`[IRM][${label}] → POST ${env.EVOLVE_API_URL}`);
    console.log(`[IRM][${label}] request body\n${redactXml(xmlRequest)}`);
  }
  try {
    const response = await fetch(env.EVOLVE_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body:    xmlRequest,
      signal:  AbortSignal.timeout(env.EVOLVE_HTTP_TIMEOUT_MS),
    });
    const body = await response.text();
    if (env.EVOLVE_DEBUG_LOG) {
      console.log(`[IRM][${label}] ← status ${response.status}`);
      console.log(`[IRM][${label}] response headers`, redactHeaders(response.headers));
      console.log(`[IRM][${label}] response body\n${redactXml(body)}`);
    }
    return { status: response.status, headers: response.headers, body };
  } catch (err) {
    const cls = classifyTransportError(err);
    (err as { __evolveClass?: EvolveErrorClass; __evolveTransient?: boolean }).__evolveClass = cls;
    (err as { __evolveTransient?: boolean }).__evolveTransient = isTransientTransportError(err);
    // Never swallow — always surface the full error + undici cause.
    console.error(`[IRM][${label}] ${cls}`, describeError(err));
    throw err;
  }
}

// Shared hardened POST for callers that need the RAW response body (e.g. the
// master-data lookup sync, which does its own regex parsing). Same transport
// hardening as callIrm: redacted debug logging + transport-error classification
// (via evolveHttpPost), transient-transport retry, transient-Evolve-failure
// retry, and a non-2xx throw. Returns the response body string on success.
export async function postEvolveXml(xmlRequest: string, label: string): Promise<string> {
  const MAX_ATTEMPTS = 2;
  let lastRawXml = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      // 500ms backoff — matches callIrm's schedule.
      await new Promise((r) => setTimeout(r, 500 * (attempt - 1) ** 2));
    }

    let res: { status: number; headers: Headers; body: string };
    try {
      res = await evolveHttpPost(xmlRequest, label);
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isTransientTransportError(err)) {
        console.log(`[IRM] ${label} ${classifyTransportError(err)} on attempt ${attempt}, retrying...`);
        continue;
      }
      throw err;
    }
    lastRawXml = res.body;

    if (res.status < 200 || res.status >= 300) {
      throw httpError(label, res.status, lastRawXml);
    }

    if (attempt < MAX_ATTEMPTS && isTransientEvolveFailure(lastRawXml)) {
      console.log(`[IRM] ${label} transient failure on attempt ${attempt}, retrying...`);
      continue;
    }

    return lastRawXml;
  }

  return lastRawXml;
}

// ─── XML Request Builder ──────────────────────────────────────────────────────

interface XmlRequestOptions {
  functionName: string;
  requestBody: Record<string, any>;
  targetSystem?: string;
  messageCreator?: string;
  // Overrides env.EVOLVE_INTERFACE_CODE for this request (e.g. a per-company
  // selector in the UI). Falls back to the env default when omitted/blank.
  interfaceCode?: string;
}

function buildXmlRequest(options: XmlRequestOptions): string {
  const { functionName, requestBody, targetSystem, messageCreator, interfaceCode } = options;
  const trackingId = uuidv4();
  const dateTime   = formatDateTime();

  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<Integration>\n`;
  xml += `  <Action>\n`;
  xml += `    <Function Type="Request">${escapeXml(functionName)}</Function>\n`;
  xml += `    <Version>1</Version>\n`;
  xml += `    <SourceSystem>${escapeXml(env.EVOLVE_SOURCE_SYSTEM)}</SourceSystem>\n`;
  xml += `    <TargetSystem>${escapeXml(targetSystem ?? env.EVOLVE_TARGET_SYSTEM)}</TargetSystem>\n`;
  xml += `    <MessageCreator>${escapeXml(messageCreator ?? env.EVOLVE_MESSAGE_CREATOR)}</MessageCreator>\n`;
  xml += `    <MessageCreationDateTime>${dateTime}</MessageCreationDateTime>\n`;
  xml += `    <MessageTrackingIdentifier>${trackingId}</MessageTrackingIdentifier>\n`;
  xml += `    <InterfaceCode>${escapeXml(interfaceCode || env.EVOLVE_INTERFACE_CODE)}</InterfaceCode>\n`;
  xml += `  </Action>\n`;
  xml += `  <Request>\n`;

  for (const [key, value] of Object.entries(requestBody)) {
    if (value === null || value === undefined) continue;
    xml += `    <${key}>${escapeXml(String(value))}</${key}>\n`;
  }

  xml += `  </Request>\n`;
  xml += `</Integration>`;

  return xml;
}

// ─── Customer Maintenance (WRITE customer to Evolve) ─────────────────────────
// IRM_CustomerMaintenance creates/updates a customer in Evolve. Idempotent
// (confirmed by Evolve) → safe to retry. Returns the Evolve-generated
// CRMReferenceNo and DMSReferenceNo (= globally-unique CustSequenceID).
//
// Envelope mirrors the WORKING apitest harness (apitest/src/tests/
// customer-maintenance.ts), which used the config defaults with no overrides →
// here that is env.EVOLVE_SOURCE_SYSTEM / _TARGET_SYSTEM / _MESSAGE_CREATOR.
// NOTE: the official sample 04a_CustomerMaintenance_Request.xml shows
// CRM / Evolve / CRM instead — confirm the accepted direction against UAT
// before enabling writes (validation item, Phase 3+).

export interface CustomerMaintenanceInput {
  rowId?: string;
  /** Flat key→value map serialized under <CustomerDetail>. */
  customerDetail: Record<string, string | number | null | undefined>;
  /** Optional key→value map serialized under <CustomerProfile>. */
  customerProfile?: Record<string, string | number | null | undefined>;
  /**
   * Optional key→value map serialized under <AccountsReceivable>.
   *
   * Keys must be the WRITE contract's names (04a): AccountType, CreditLimit,
   * CurrencyCode, DefaultTaxCode, StopCredit, TermsCode, AccountNumber,
   * InActiveAccount. These deliberately differ from the names the READ
   * contract returns (ArAccountType / CreditLimitAmount / ArAccountNumber /
   * InactiveAccount), so callers must not reuse the parsed shape verbatim.
   *
   * Evolve cannot post a labour line under Cost Jobs for a customer with no AR
   * master record ("No artArMaster Record Available"), which is what this block
   * exists to create.
   */
  accountsReceivable?: Record<string, string | number | null | undefined>;
  /** Per-company Evolve InterfaceCode; falls back to env when omitted (Phase C). */
  interfaceCode?: string;
}

export interface CustomerMaintenanceResult {
  /** true only when RequestStatus=S AND RowStatus in (S, W). */
  success: boolean;
  requestStatus: string | null;   // Result.RequestStatus  (S/F/W)
  rowStatus: string | null;        // Response.RowDetails.RowStatus (S/F/W)
  crmReferenceNo: string | null;   // Evolve-generated CRM number
  custSequenceId: string | null;   // Evolve DMSReferenceNo (globally unique)
  message: string | null;
  rawXml: string;
}

// Recursive serializer for the nested RowDetails/CustomerDetail/CustomerProfile
// body (the flat buildXmlRequest above can't nest). Skips null/undefined.
function nestedObjectToXml(obj: Record<string, any>, indent: string): string {
  let xml = '';
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      xml += `${indent}<${key}>\n${nestedObjectToXml(value, indent + '  ')}${indent}</${key}>\n`;
    } else {
      xml += `${indent}<${key}>${escapeXml(String(value))}</${key}>\n`;
    }
  }
  return xml;
}

// Exported for unit testing, matching buildRoMaintenanceXml /
// renderRoJobHeaderRows — pure string building, no db and no network.
export function buildCustomerMaintenanceXml(input: CustomerMaintenanceInput): string {
  const trackingId = uuidv4();
  const dateTime   = formatDateTime();
  const rowId      = input.rowId ?? '000001';

  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<Integration>\n`;
  xml += `  <Action>\n`;
  xml += `    <Function Type="Request">IRM_CustomerMaintenance</Function>\n`;
  xml += `    <Version>1</Version>\n`;
  xml += `    <SourceSystem>${escapeXml(env.EVOLVE_SOURCE_SYSTEM)}</SourceSystem>\n`;
  xml += `    <TargetSystem>${escapeXml(env.EVOLVE_TARGET_SYSTEM)}</TargetSystem>\n`;
  xml += `    <MessageCreator>${escapeXml(env.EVOLVE_MESSAGE_CREATOR)}</MessageCreator>\n`;
  xml += `    <MessageCreationDateTime>${dateTime}</MessageCreationDateTime>\n`;
  xml += `    <MessageTrackingIdentifier>${trackingId}</MessageTrackingIdentifier>\n`;
  xml += `    <InterfaceCode>${escapeXml(input.interfaceCode || env.EVOLVE_INTERFACE_CODE)}</InterfaceCode>\n`;
  xml += `  </Action>\n`;
  xml += `  <Request>\n`;
  xml += `    <RowDetails>\n`;
  xml += `      <RowID>${escapeXml(rowId)}</RowID>\n`;
  xml += nestedObjectToXml({ CustomerDetail: input.customerDetail }, '      ');
  if (input.customerProfile) {
    xml += nestedObjectToXml({ CustomerProfile: input.customerProfile }, '      ');
  }
  // Block order follows the contract: CustomerDetail → CustomerProfile →
  // AccountsReceivable. Omitted entirely when the caller supplies nothing, so a
  // customer with no AR data yields a byte-identical payload to before.
  if (input.accountsReceivable) {
    xml += nestedObjectToXml({ AccountsReceivable: input.accountsReceivable }, '      ');
  }
  xml += `    </RowDetails>\n`;
  xml += `  </Request>\n`;
  xml += `</Integration>`;
  return xml;
}

function parseMaintenanceResponse(rawXml: string): CustomerMaintenanceResult {
  const base: CustomerMaintenanceResult = {
    success: false, requestStatus: null, rowStatus: null,
    crmReferenceNo: null, custSequenceId: null, message: null, rawXml,
  };
  let parsed: any;
  try { parsed = xmlParser.parse(rawXml); } catch { return base; }

  const integration   = parsed?.Integration ?? parsed;
  const result        = integration?.Result;
  const requestStatus = result?.RequestStatus != null ? String(result.RequestStatus).trim() : null;

  let row = integration?.Response?.RowDetails;
  if (Array.isArray(row)) row = row[0];
  const flat = row && typeof row === 'object' ? flattenToStrings(row) : {};

  const rowStatus      = flat.RowStatus ?? null;
  const crmReferenceNo = flat.CRMReferenceNo ?? null;
  const custSequenceId = flat.DMSReferenceNo ?? null;   // Evolve's CustSequenceID
  const message        = flat.RowDetailedMessage
    ?? (result?.RequestStatusMessage != null ? String(result.RequestStatusMessage).trim() : null);

  const success = requestStatus === 'S' && (rowStatus === 'S' || rowStatus === 'W');
  return { success, requestStatus, rowStatus, crmReferenceNo, custSequenceId, message, rawXml };
}

/**
 * Create/update a customer in Evolve. Idempotent — retried on transient failure.
 * Throws only on a non-2xx HTTP after retries; otherwise returns a result whose
 * `success` flag must be checked by the caller.
 */
export async function customerMaintenance(input: CustomerMaintenanceInput): Promise<CustomerMaintenanceResult> {
  assertEvolveWriteAllowed('IRM_CustomerMaintenance');
  const xmlRequest = buildCustomerMaintenanceXml(input);
  const MAX_ATTEMPTS = 2;
  let lastRawXml = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 500 * (attempt - 1) ** 2));

    const response = await fetch(env.EVOLVE_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body:    xmlRequest,
      signal:  AbortSignal.timeout(env.EVOLVE_HTTP_TIMEOUT_MS),
    });

    lastRawXml = await response.text();

    if (!response.ok) {
      if (attempt < MAX_ATTEMPTS) continue;
      throw new Error(`Evolve CustomerMaintenance HTTP ${response.status}: ${lastRawXml.substring(0, 200)}`);
    }

    if (attempt < MAX_ATTEMPTS && isTransientEvolveFailure(lastRawXml)) {
      console.log(`[IRM] CustomerMaintenance transient failure on attempt ${attempt}, retrying...`);
      continue;
    }

    return parseMaintenanceResponse(lastRawXml);
  }

  return parseMaintenanceResponse(lastRawXml);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerVehicleLookupResult {
  found:              boolean;
  CustomerDetail:     Record<string, string>;
  CustomerProfile:    Record<string, string>;
  // First vehicle in the response (backward-compat shape for callers that
  // expect a single vehicle object).
  Vehicles:           Record<string, string>;
  // All vehicles returned for this customer. Many B2B customers own a fleet,
  // so Evolve can return multiple <RowDetails> inside <Vehicles>.
  VehiclesAll:        Record<string, string>[];
  AccountsReceivable: Record<string, string | number | boolean>;
}

export interface LookupCustomerParams {
  phone?: string;
  reg?:   string;
  vin?:   string;
  // Per-company Evolve InterfaceCode override; falls back to env when omitted.
  interfaceCode?: string;
}

// ─── Phone canonicalisation ─────────────────────────────────────────────────
// Canonical Evolve phone form = country code (EVOLVE_PHONE_COUNTRY_CODE, default
// "27") + the national number with the trunk "0" stripped. This is the format we
// WRITE for every customer we create/sync, so it is consistent and searchable.
//   "6833368"      → "276833368"
//   "0116833368"   → "27116833368"
//   "+27 68 3 3368"→ "276833368"
// Idempotent: a value already starting with the country code is never double-
// prefixed (satisfies "numbers already starting with 27 are not re-prefixed").
export function toEvolvePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let d = raw.replace(/\D/g, ''); // digits only
  if (!d) return '';
  const cc = env.EVOLVE_PHONE_COUNTRY_CODE || '27';
  if (d.startsWith('0')) d = d.replace(/^0+/, ''); // drop trunk zero(s)
  if (d.startsWith(cc)) return d;                  // already international → no double prefix
  return cc + d;
}

// Split the canonical form into Evolve's two fields:
// CellphoneCode = country code ("27"), CellphoneNumber = the national number.
export function splitEvolvePhone(raw: string | null | undefined): { code: string; number: string } {
  const canon = toEvolvePhone(raw);
  if (!canon) return { code: '', number: '' };
  const cc = env.EVOLVE_PHONE_COUNTRY_CODE || '27';
  return { code: cc, number: canon.slice(cc.length) };
}

// Legacy trunk-"0" form — the shape native Evolve records use (area code kept,
// leading "0", e.g. "0116833368"). Retained ONLY as a secondary phone-search
// candidate so lookups still match records stored the old way. No regression.
export function legacyZeroPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const cc = env.EVOLVE_PHONE_COUNTRY_CODE;
  if (cc && digits.startsWith(cc) && digits.length > 10) digits = digits.substring(cc.length);
  if (!digits.startsWith('0')) digits = '0' + digits;
  return digits;
}

// Distinct phone forms a lookup should try, in priority order:
//   [1] 27-canonical  → matches customers this app writes going forward,
//   [2] legacy 0-form → matches pre-existing / native Evolve records.
// De-duplicated (a "+27 …" input collapses to a single form).
export function phoneSearchCandidates(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const v of [toEvolvePhone(raw), legacyZeroPhone(raw)]) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// ─── Parse Response ───────────────────────────────────────────────────────────

function parseResponseXml(rawXml: string): CustomerVehicleLookupResult {
  const empty: CustomerVehicleLookupResult = {
    found: false, CustomerDetail: {}, CustomerProfile: {}, Vehicles: {}, VehiclesAll: [], AccountsReceivable: {},
  };

  let parsed: any;
  try {
    parsed = xmlParser.parse(rawXml);
  } catch (e) {
    console.error('[IRM] XML parse error:', e);
    return empty;
  }

  console.log('[IRM] top-level keys:', Object.keys(parsed ?? {}));

  const integration = parsed?.Integration ?? parsed;
  const result      = integration?.Result;
  const status      = result?.RequestStatus;

  console.log('[IRM] Result:', JSON.stringify(result));
  console.log('[IRM] status:', status);

  // Success only when RequestStatus is exactly 'S' — aligned with the
  // maintenance parsers (parseMaintenanceResponse / parseRoMaintenanceResponse).
  // Any other value (missing / 'Failed' / 'F' / 'W' / unknown) → empty result.
  // NOT_FOUND is unchanged: an 'S' response with zero rows still yields empty
  // via rowDetailsToResult below.
  if (String(status ?? '').trim() !== 'S') {
    console.log('[IRM] returning empty — RequestStatus not S');
    return empty;
  }

  // Evolve returns an array of <RowDetails> when multiple customers match
  // (e.g. phone search hits several customers sharing the same number).
  const rawRowDetails = integration?.Response?.RowDetails;
  const rowDetails = Array.isArray(rawRowDetails) ? rawRowDetails[0] : rawRowDetails;
  console.log('[IRM] total matches:', Array.isArray(rawRowDetails) ? rawRowDetails.length : (rowDetails ? 1 : 0));
  if (!rowDetails) {
    return empty;
  }

  return rowDetailsToResult(rowDetails) ?? empty;
}

// Convert a single <RowDetails> block into our normalised result shape.
function rowDetailsToResult(rowDetails: any): CustomerVehicleLookupResult | null {
  const CustomerDetail  = flattenToStrings(rowDetails?.CustomerDetail  ?? {});
  const CustomerProfile = flattenToStrings(rowDetails?.CustomerProfile ?? {});

  // Evolve returns multiple <RowDetails> inside <Vehicles> for fleet customers.
  // fast-xml-parser gives us an array in that case; normalise to one.
  const rawVehicleRows = rowDetails?.Vehicles?.RowDetails;
  const vehicleRowArr = Array.isArray(rawVehicleRows)
    ? rawVehicleRows
    : (rawVehicleRows ? [rawVehicleRows] : []);
  const VehiclesAll = vehicleRowArr.map((v: any) => flattenToStrings(v));
  const Vehicles    = VehiclesAll[0] ?? {};
  console.log('[IRM] vehicles for this customer:', VehiclesAll.length);

  const arRow            = rowDetails?.AccountsReceivable?.RowDetails ?? {};
  const AccountsReceivable: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(arRow)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'object') {
      const text = (val as any)['#text'];
      if (text !== null && text !== undefined) AccountsReceivable[key] = text;
    } else {
      AccountsReceivable[key] = val as string | number | boolean;
    }
  }

  const hasData = Object.keys(CustomerDetail).length > 0 || VehiclesAll.length > 0;
  if (!hasData) return null;

  return { found: true, CustomerDetail, CustomerProfile, Vehicles, VehiclesAll, AccountsReceivable };
}

// Parse an Evolve XML response into an ARRAY of normalised results.
// Used by phone-search style lookups where multiple customers may match.
function parseAllResponseXml(rawXml: string): CustomerVehicleLookupResult[] {
  let parsed: any;
  try {
    parsed = xmlParser.parse(rawXml);
  } catch (e) {
    console.error('[IRM] XML parse error:', e);
    return [];
  }

  const integration = parsed?.Integration ?? parsed;
  const status      = integration?.Result?.RequestStatus;

  // Success only when RequestStatus is exactly 'S' (aligned with maintenance).
  // Non-S → zero rows; classifyLookupOutcome then distinguishes NOT_FOUND
  // (status S / known "no record" markers) from UNAVAILABLE, so NOT_FOUND
  // behaviour is preserved and retry logic is untouched.
  if (String(status ?? '').trim() !== 'S') {
    return [];
  }

  const raw = integration?.Response?.RowDetails;
  const rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  console.log('[IRM] parseAll → rows:', rows.length);

  return rows
    .map((r) => rowDetailsToResult(r))
    .filter((r): r is CustomerVehicleLookupResult => r !== null);
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Evolve's Progress backend occasionally returns transient capacity errors
// (`NoAvailableSessions`, `ERROR_ProgressErrorReturned`) when their session
// pool is briefly exhausted. Retry with a short backoff so users don't see
// a hard failure for a 1-2 second blip on their side.
const TRANSIENT_PATTERNS = [
  /NoAvailableSessions/i,
  /Failed SetProxy/i,
  /SessionPool/i,
];

// Permanent "not found" responses look like Progress errors but should NOT
// trigger a retry — Evolve genuinely doesn't have this customer/VIN/reg.
const NOT_FOUND_PATTERNS = [
  /No Customer Master record found/i,
  /No vehicle record found/i,
  /No record found/i,
];

// Typed lookup outcome (Phase 1). Lets callers distinguish an authoritative
// "Evolve has no record" (NOT_FOUND) from "Evolve could not answer" (UNAVAILABLE)
// — previously both collapsed to an empty array.
export type IrmSearchOutcome = 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';
export interface IrmSearchResult {
  outcome: IrmSearchOutcome;
  results: CustomerVehicleLookupResult[];
}

// Classify a successful (HTTP 2xx) Evolve lookup body into an outcome:
//   FOUND       — one or more rows.
//   NOT_FOUND   — Evolve processed the request and has no match: RequestStatus=S
//                 with zero rows, OR a known "no record" message.
//   UNAVAILABLE — a failure with no not-found marker (Evolve couldn't answer
//                 authoritatively) — we must not treat this as a real "no record".
function classifyLookupOutcome(rawXml: string, rows: CustomerVehicleLookupResult[]): IrmSearchResult {
  if (rows.length > 0) return { outcome: 'FOUND', results: rows };
  if (NOT_FOUND_PATTERNS.some((p) => p.test(rawXml))) return { outcome: 'NOT_FOUND', results: [] };
  const status = rawXml.match(/<RequestStatus>\s*([^<]*)<\/RequestStatus>/i)?.[1]?.trim().toUpperCase() ?? '';
  if (status === 'S') return { outcome: 'NOT_FOUND', results: [] };
  return { outcome: 'UNAVAILABLE', results: [] };
}

function isTransientEvolveFailure(rawXml: string): boolean {
  if (NOT_FOUND_PATTERNS.some((p) => p.test(rawXml))) return false;
  return TRANSIENT_PATTERNS.some((p) => p.test(rawXml));
}

async function callIrm(xmlRequest: string): Promise<CustomerVehicleLookupResult> {
  const MAX_ATTEMPTS = 2;
  let lastRawXml = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      // 500ms, 1500ms backoff — total worst-case extra latency ≈ 2s.
      await new Promise((r) => setTimeout(r, 500 * (attempt - 1) ** 2));
    }

    let res: { status: number; headers: Headers; body: string };
    try {
      res = await evolveHttpPost(xmlRequest, 'callIrm');
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isTransientTransportError(err)) {
        console.log(`[IRM] callIrm ${classifyTransportError(err)} on attempt ${attempt}, retrying...`);
        continue;
      }
      throw err;
    }
    lastRawXml = res.body;

    // HTTP error: never retried here (4xx and 5xx alike) — preserves existing
    // callIrm behaviour. Full body logged via httpError (no truncation).
    if (res.status < 200 || res.status >= 300) {
      throw httpError('API', res.status, lastRawXml);
    }

    if (attempt < MAX_ATTEMPTS && isTransientEvolveFailure(lastRawXml)) {
      console.log(`[IRM] transient failure on attempt ${attempt}, retrying...`);
      continue;
    }

    return parseResponseXml(lastRawXml);
  }

  return parseResponseXml(lastRawXml);
}

// Plural variant — returns ALL matching customers. Use this for ambiguous
// searches (phone, last name) where Evolve may return many rows.
async function callIrmAll(xmlRequest: string): Promise<IrmSearchResult> {
  const MAX_ATTEMPTS = 3;
  let lastRawXml = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt - 1) ** 2));
    }

    let res: { status: number; headers: Headers; body: string };
    try {
      res = await evolveHttpPost(xmlRequest, 'callIrmAll');
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isTransientTransportError(err)) {
        console.log(`[IRM] callIrmAll ${classifyTransportError(err)} on attempt ${attempt}, retrying...`);
        continue;
      }
      // Exhausted / non-transient transport failure — Evolve gave no answer.
      console.error(`[IRM] callIrmAll transport failure: ${describeError(err)}`);
      return { outcome: 'UNAVAILABLE', results: [] };
    }
    lastRawXml = res.body;

    if (res.status < 200 || res.status >= 300) {
      // Non-2xx: not an authoritative "not found" — treat as unavailable.
      console.error(`[IRM] callIrmAll HTTP ${res.status}`);
      return { outcome: 'UNAVAILABLE', results: [] };
    }

    if (attempt < MAX_ATTEMPTS && isTransientEvolveFailure(lastRawXml)) {
      console.log(`[IRM] transient failure on attempt ${attempt}, retrying...`);
      continue;
    }

    return classifyLookupOutcome(lastRawXml, parseAllResponseXml(lastRawXml));
  }

  return classifyLookupOutcome(lastRawXml, parseAllResponseXml(lastRawXml));
}

export async function lookupCustomer(params: LookupCustomerParams): Promise<CustomerVehicleLookupResult> {
  return callIrm(buildXmlRequest({
    functionName: 'IRM_Customer_VehicleLookup',
    targetSystem:  'CRM',
    messageCreator: 'CRM',
    interfaceCode: params.interfaceCode,
    requestBody: {
      MaxNoRowsReturned:    10,
      CRMReferenceNo:       '',
      CustSequenceID:       '',
      IDNumber:             '',
      FirstName:            '',
      LastName:             '',
      CompanyName:          '',
      CellphoneCodeNumber:  params.phone ?? '',
      PrimaryEmail:         '',
      RegistrationNo:       params.reg   ?? '',
      VehVinNumber:         params.vin   ?? '',
      VinLast8:             '',
    },
  }));
}

// Returns all matching customers (up to MaxNoRowsReturned). Phone searches
// often match multiple — the FE shows a picker for the user to choose.
export async function lookupCustomers(params: LookupCustomerParams): Promise<IrmSearchResult> {
  return callIrmAll(buildXmlRequest({
    functionName: 'IRM_Customer_VehicleLookup',
    targetSystem:  'CRM',
    messageCreator: 'CRM',
    interfaceCode: params.interfaceCode,
    requestBody: {
      // 100 rows — covers most phone-shared B2B groups (e.g. ELT family
      // currently has 9 sub-companies). Bump higher if customer base grows.
      MaxNoRowsReturned:    100,
      CRMReferenceNo:       '',
      CustSequenceID:       '',
      IDNumber:             '',
      FirstName:            '',
      LastName:             '',
      CompanyName:          '',
      CellphoneCodeNumber:  params.phone ?? '',
      PrimaryEmail:         '',
      RegistrationNo:       params.reg   ?? '',
      VehVinNumber:         params.vin   ?? '',
      VinLast8:             '',
    },
  }));
}

// Customer-only lookup (IRM_CustomerLookup). Unlike IRM_Customer_VehicleLookup,
// this does NOT require the customer to have a vehicle in Evolve, so it finds
// customers we pushed via CustomerMaintenance (which can't carry a vehicle —
// Evolve has no vehicle-create API). Used as a FALLBACK in the booking search
// so synced / vehicle-less customers are still findable by phone. Envelope
// (Source=Evolve / Target=WMS / Creator=WMS) matches the verified UAT probe.
export async function lookupCustomersOnly(params: LookupCustomerParams): Promise<IrmSearchResult> {
  return callIrmAll(buildXmlRequest({
    functionName: 'IRM_CustomerLookup',
    targetSystem:  'WMS',
    messageCreator: 'WMS',
    interfaceCode: params.interfaceCode,
    requestBody: {
      MaxNoRowsReturned:    100,
      CRMReferenceNo:       '',
      CustSequenceID:       '',
      IDNumber:             '',
      FirstName:            '',
      LastName:             '',
      CompanyName:          '',
      CellphoneCodeNumber:  params.phone ?? '',
      PrimaryEmail:         '',
      RegistrationNo:       params.reg   ?? '',
      VehVinNumber:         params.vin   ?? '',
      VinLast8:             '',
      FinanceInstitution:   '',
    },
  }));
}

export async function lookupByCustSequenceId(custSequenceId: string): Promise<CustomerVehicleLookupResult> {
  return callIrm(buildXmlRequest({
    functionName: 'IRM_Customer_VehicleLookup',
    targetSystem:  'CRM',
    messageCreator: 'CRM',
    requestBody: {
      MaxNoRowsReturned:    10,
      CRMReferenceNo:       '',
      CustSequenceID:       custSequenceId,
      IDNumber:             '',
      FirstName:            '',
      LastName:             '',
      CompanyName:          '',
      CellphoneCodeNumber:  '',
      PrimaryEmail:         '',
      RegistrationNo:       '',
      VehVinNumber:         '',
      VinLast8:             '',
    },
  }));
}

// ─── AR accounts (IRM_CustomerLookup) ───────────────────────────────────────

/** One Evolve AR (Accounts Receivable) account belonging to a customer. */
export interface ArAccount {
  /** Evolve AR sequence id (DbArSeqID / ArSeqID). */
  arSeqId: string;
  /** The account number posted as <ARAccountNo>. */
  accountNumber: string;
  /** Department type code, e.g. 'VH', 'PT', 'SV'. */
  accountType: string;
  /** Human label, e.g. 'Retail Vehicles'. */
  typeDescription: string;
  inactive: boolean;
  stopCredit: boolean;
}

// Evolve returns the AR block in TWO different shapes, so both are handled:
//
//   live (observed 20EC, 2026-09-09)   documented (03b_CustomerLookup_Response)
//   <AccountsReceivable>               <AccountsReceivable>
//     <RowDetails>                       <PartsType>   … </PartsType>
//       <DbArSeqID/>                     <VehicleType> … </VehicleType>
//       <ArAccountNumber/>               <ServiceType> … </ServiceType>
//       <ArAccountType/>                 <ForecourtType>…</ForecourtType>
//     </RowDetails>                    </AccountsReceivable>
//   </AccountsReceivable>
//
// and the live shape can repeat <RowDetails> once per account. Field names also
// differ between the two (ArAccountNumber vs AccountNumber, DbArSeqID vs
// ArSeqID), so each is read with a fallback. Anything without an account number
// is skipped rather than returned as a blank option.
//
// NOTE: this is deliberately separate from parseResponseXml's single-account
// `AccountsReceivable` map, which flattens one account for customer_ar. That
// map cannot represent a list (Object.entries over a repeated RowDetails array
// yields index keys and drops every account), and changing its shape would
// ripple through evolveCustomerPersist and the customers module. Exported for
// unit testing; pure — no db, no network.
export function parseArAccounts(raw: unknown): ArAccount[] {
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return String((v as any)['#text'] ?? '').trim();
    return String(v).trim();
  };
  const yes = (v: unknown): boolean => text(v).toLowerCase() === 'yes' || text(v).toLowerCase() === 'true';

  const block = raw as Record<string, any> | null | undefined;
  if (!block || typeof block !== 'object') return [];

  // Collect candidate account objects from either shape.
  const candidates: any[] = [];
  const rows = block.RowDetails;
  if (rows) {
    for (const r of Array.isArray(rows) ? rows : [rows]) candidates.push(r);
  }
  for (const [key, val] of Object.entries(block)) {
    if (key === 'RowDetails' || !val || typeof val !== 'object') continue;
    // A per-type sub-block (PartsType / VehicleType / …).
    for (const v of Array.isArray(val) ? val : [val]) candidates.push(v);
  }

  const out: ArAccount[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const accountNumber = text(c.ArAccountNumber) || text(c.AccountNumber);
    if (!accountNumber) continue; // never offer a blank account
    if (seen.has(accountNumber)) continue;
    seen.add(accountNumber);
    out.push({
      arSeqId:         text(c.DbArSeqID) || text(c.ArSeqID),
      accountNumber,
      accountType:     text(c.ArAccountType),
      typeDescription: text(c.ArTypeDescrip),
      inactive:        yes(c.InactiveAccount),
      stopCredit:      yes(c.StopCredit),
    });
  }
  return out;
}

/**
 * Every AR account Evolve holds for one customer, via IRM_CustomerLookup.
 *
 * IRM_CustomerLookup is used rather than the IRM_Customer_VehicleLookup helper
 * above because it is the call proven to return a populated AR block for 20EC,
 * and it does not drag the customer's whole vehicle list along with it.
 *
 * Returns [] on any failure (transport, non-success status, no AR block) — the
 * caller shows an empty account list, never a crash.
 */
export async function lookupCustomerArAccounts(custSequenceId: string, interfaceCode?: string): Promise<ArAccount[]> {
  const seq = String(custSequenceId ?? '').trim();
  if (!seq) return [];

  const xmlRequest = buildXmlRequest({
    functionName: 'IRM_CustomerLookup',
    interfaceCode,
    requestBody: {
      MaxNoRowsReturned:   10,
      CRMReferenceNo:      '',
      CustSequenceID:      seq,
      IDNumber:            '',
      FirstName:           '',
      LastName:            '',
      CompanyName:         '',
      CellphoneCodeNumber: '',
      PrimaryEmail:        '',
      RegistrationNo:      '',
      VehVinNumber:        '',
      VinLast8:            '',
      FinanceInstitution:  '',
    },
  });

  try {
    const res = await evolveHttpPost(xmlRequest, 'lookupCustomerArAccounts');
    if (res.status < 200 || res.status >= 300) {
      console.warn(`[IRM] CustomerLookup HTTP ${res.status} for ${seq} — no AR accounts returned`);
      return [];
    }
    const parsed: any = xmlParser.parse(res.body);
    const integration = parsed?.Integration ?? parsed;
    const status = String(integration?.Result?.RequestStatus ?? '').trim();
    if (status && status !== 'S') {
      console.warn(`[IRM] CustomerLookup RequestStatus=${status} for ${seq} — no AR accounts returned`);
      return [];
    }
    // Response.RowDetails may itself repeat (one per matched customer).
    const rowDetails = integration?.Response?.RowDetails;
    const first = Array.isArray(rowDetails) ? rowDetails[0] : rowDetails;
    const accounts = parseArAccounts(first?.AccountsReceivable);
    console.log(`[IRM] CustomerLookup ${seq} → ${accounts.length} AR account(s)`);
    return accounts;
  } catch (err) {
    console.error(`[IRM] CustomerLookup failed for ${seq}:`, (err as Error)?.message);
    return [];
  }
}

export async function lookupVehicleByVin(vin: string, interfaceCode?: string): Promise<CustomerVehicleLookupResult> {
  return callIrm(buildXmlRequest({
    functionName: 'IRM_Customer_VehicleLookup',
    targetSystem:  'CRM',
    messageCreator: 'CRM',
    interfaceCode,
    requestBody: {
      MaxNoRowsReturned:   10,
      CRMReferenceNo:      '',
      CustSequenceID:      '',
      IDNumber:            '',
      FirstName:           '',
      LastName:            '',
      CompanyName:         '',
      CellphoneCodeNumber: '',
      PrimaryEmail:        '',
      RegistrationNo:      '',
      VehVinNumber:        vin,
      VinLast8:            '',
    },
  }));
}

// ─── RO History Lookup (duplicate recovery) ─────────────────────────────────
// IRM_ROHistoryLookup — returns prior repair orders for a vehicle/customer.
// Contract per apitest 14a (request) / 14b (response): envelope Evolve/CRM/CRM;
// request fields MaxNoRowsReturned, RONumber, CustSequenceID, LastName,
// RegistrationNo, VehVinNumber, DateRangeFrom, DateRangeTo; response rows under
// Response/RowDetails/ROMaintenance with CRMReferenceNo (our Integration ID) and
// RONumber (Evolve's authoritative RO number). Used to detect a CREATE that
// committed in Evolve but lost its HTTP response, so a retry can adopt the
// existing RO instead of creating a duplicate.

export interface RoHistoryEntry {
  roNumber: string | null;       // ROMaintenance.RONumber (Evolve RO number)
  crmReferenceNo: string | null; // ROMaintenance.CRMReferenceNo (our Integration ID)
  vin: string | null;            // ROMaintenance.VehVinNumber
}

export interface RoHistoryLookupParams {
  vin?: string;
  custSequenceId?: string;
  registrationNo?: string;
  lastName?: string;
  dateRangeFrom?: string; // dd/MM/yyyy
  dateRangeTo?: string;   // dd/MM/yyyy
  interfaceCode?: string; // per-company Evolve InterfaceCode; env fallback
  maxRows?: number;
}

// Returns the parsed entries on a successful (RequestStatus='S') response — the
// array may be empty (a genuine "no history" result). Returns null when the
// lookup could NOT be answered authoritatively (parse error or non-'S' status),
// so the caller can distinguish SUCCESS_EMPTY from LOOKUP_FAILED.
function parseRoHistoryResponse(rawXml: string): RoHistoryEntry[] | null {
  let parsed: any;
  try { parsed = xmlParser.parse(rawXml); } catch { return null; }
  const integration = parsed?.Integration ?? parsed;
  if (String(integration?.Result?.RequestStatus ?? '').trim() !== 'S') return null;
  const raw = integration?.Response?.RowDetails;
  const rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const strv = (x: unknown): string | null => {
    if (x === null || x === undefined) return null;
    const t = typeof x === 'object' ? (x as any)['#text'] : x;
    const s = t === null || t === undefined ? '' : String(t).trim();
    return s || null;
  };
  return rows
    .map((r: any) => {
      const ro = r?.ROMaintenance ?? {};
      return { roNumber: strv(ro.RONumber), crmReferenceNo: strv(ro.CRMReferenceNo), vin: strv(ro.VehVinNumber) };
    })
    .filter((e: RoHistoryEntry) => e.roNumber || e.crmReferenceNo);
}

// Discriminated result so the caller can tell an authoritative "no history"
// (ok:true, entries possibly empty) apart from an unanswerable lookup
// (ok:false — transport/HTTP/parse/non-'S'). The latter must NOT be treated as
// "no prior RO", or a retry could recreate the duplicate this feature prevents.
export type RoHistoryLookupResult =
  | { ok: true; entries: RoHistoryEntry[] }
  | { ok: false };

/**
 * Look up a vehicle/customer's RO history. Never throws. Returns { ok:false }
 * when the lookup could not be completed authoritatively; { ok:true, entries }
 * (entries may be empty) on a successful response.
 */
export async function lookupRoHistory(params: RoHistoryLookupParams): Promise<RoHistoryLookupResult> {
  assertEvolveWriteAllowed('IRM_ROHistoryLookup');
  const xml = buildXmlRequest({
    functionName: 'IRM_ROHistoryLookup',
    targetSystem:  'CRM',
    messageCreator: 'CRM',
    interfaceCode: params.interfaceCode,
    requestBody: {
      MaxNoRowsReturned: params.maxRows ?? 999,
      RONumber:          '',
      CustSequenceID:    params.custSequenceId ?? '',
      LastName:          params.lastName ?? '',
      RegistrationNo:    params.registrationNo ?? '',
      VehVinNumber:      params.vin ?? '',
      ...(params.dateRangeFrom ? { DateRangeFrom: params.dateRangeFrom } : {}),
      ...(params.dateRangeTo ? { DateRangeTo: params.dateRangeTo } : {}),
    },
  });
  try {
    const body = await postEvolveXml(xml, 'ROHistoryLookup');
    const entries = parseRoHistoryResponse(body);
    if (entries === null) {
      console.error('[IRM] lookupRoHistory: non-success / unparseable response');
      return { ok: false };
    }
    return { ok: true, entries };
  } catch (err) {
    console.error(`[IRM] lookupRoHistory failed: ${(err as Error)?.message ?? err}`);
    return { ok: false };
  }
}

// Single definition of "we hold an engine number". NULL, undefined, '' and
// whitespace-only are all the SAME state — ABSENT — and collapse to ''. Shared
// by the RO payload builder (buildRoInput) and the CREATE gate
// (gateEngineNumberForCreate) so the three missing-cases can never diverge.
//
// Lives here, not in the sync service, because the import direction is
// jobCardEvolveSync -> evolveIrm (never back), so sharing it this way cannot
// create a cycle.
//
// It NEVER substitutes a value: there is no 'UNKNOWN' / 'N/A' / VIN /
// registration / random / UUID fallback anywhere in this path. Absent stays
// absent, and buildRoMaintenanceXml then omits the element entirely.
export function normalizeEngineNumber(v: string | null | undefined): string {
  return String(v ?? '').trim();
}

// ─── RO Maintenance (Job Card) ──────────────────────────────────────────────
// Create/update a Repair Order in Evolve. UAT-confirmed (2026-06-19):
//   - envelope Evolve/WMS/WMS is accepted; blank RONumber CREATEs and Evolve
//     returns the real number as DMSReferenceNo; a populated RONumber UPDATEs
//     idempotently; Evolve auto-creates the vehicle for an unknown VIN.

export interface RoMaintenanceInput {
  crmReferenceNo: string;        // our correlation ref (echoed back)
  roNumber?: string;             // blank = CREATE; Evolve RONumber = UPDATE
  interfaceCode?: string;        // per-company Evolve InterfaceCode; env fallback (Phase C)
  ownerCustSequenceId: string;   // REAL Evolve CustSequenceID (required)
  vin: string;
  registrationNo?: string;
  engineNumber?: string;
  make: string;
  modelCode: string;
  modelDescription?: string;     // vehicles.model = Evolve ModelDescription (sent alongside ModelCode)
  modelYear?: string | number;
  odoIn?: string | number;
  // Vehicle attributes from the Evolve Customer/Vehicle lookup. Both are
  // OPTIONAL in the IRM_ROMaintenance contract — 15a_ROMaintenance_Request.xml
  // carries <RegistrationDate>dd/mm/yyyy</RegistrationDate> (an unfilled
  // placeholder) and <SellingDealer>     </SellingDealer> (blanks) in a request
  // Evolve accepted. Omitted entirely when we have no value, so an UPDATE can
  // never blank a value Evolve already holds.
  registrationDate?: string;     // dd/mm/yyyy
  sellingDealer?: string;
  appointmentDate?: string;      // dd/MM/yyyy
  roStatus?: string;
  roStatusType?: string;
  serviceAdvisorNumber?: string;
  serviceDept?: string;
  franchiseSeqId?: string;
  jobType?: string;
  serviceType?: string;
  hoursEstimate?: string | number;
  valueCpaEstimate?: string | number;
  customerStates?: string;
  saInstruction?: string;
  /**
   * Card-level Evolve AR account → <ARAccountNo> on the single-job block.
   *
   * Needed as well as the per-job RoJobHeaderJob.arAccountNo because the
   * single-block fallback below is what renders whenever `jobs` is absent —
   * i.e. whenever EVOLVE_RO_MULTI_JOB_ENABLED is off, which is the default.
   * Without it, an account chosen on the job card would be stored locally and
   * never transmitted. Mirrors how jobType/serviceType already have card-level
   * counterparts consumed by the same fallback.
   */
  arAccountNo?: string;
  // Multiple jobs → one <ROJobHeader><RowDetails> per entry (multi-job RO). When
  // provided and non-empty, this REPLACES the single-block fields above. When
  // omitted, the single block is rendered from jobType/serviceType/…/saInstruction
  // exactly as before (backward compatible).
  jobs?: RoJobHeaderJob[];
  // Technician labour lines → one <ROJobDetails><RowDetails> each (PostingType=L).
  // Optional + omitted by default; populated only when labour emission is enabled.
  jobDetails?: RoJobDetailLine[];
}

// A single job within <ROJobHeader> (one <RowDetails>).
export interface RoJobHeaderJob {
  jobNumber: string;                    // sequential, e.g. '01', '02'
  jobType?: string;                     // default 'INT'
  serviceType?: string;                 // default 'S06'
  hoursEstimate?: string | number;      // SA estimated labour hours; default '0'
  valueCpaEstimate?: string | number;   // default '0'
  customerStates?: string;
  saInstruction?: string;
  /**
   * Evolve AR account this job is charged to → <ARAccountNo>. Omitted from the
   * XML when absent. Evolve cannot load a labour line under Cost Jobs without
   * an AR master (observed as "No artArMaster Record Available" on FO008450).
   */
  arAccountNo?: string;
}

// Render one or more <ROJobHeader> RowDetails from the jobs array. Follows the
// IRM spec convention that repeat data is nested in sequential <RowDetails>
// blocks. Exported for unit testing. Returns the full <ROJobHeader>…</ROJobHeader>
// element (a single header wrapping one RowDetails per job).
export function renderRoJobHeaderRows(jobs: RoJobHeaderJob[]): string {
  const v = (x: unknown) => escapeXml(String(x ?? ''));
  let xml = `      <ROJobHeader>\n`;
  for (const j of jobs) {
    xml += `        <RowDetails>\n`;
    xml += `          <JobNumber>${v(j.jobNumber)}</JobNumber>\n`;
    xml += `          <JobType>${v(j.jobType ?? 'INT')}</JobType>\n`;
    xml += `          <ServiceType>${v(j.serviceType ?? 'S06')}</ServiceType>\n`;
    xml += `          <HoursEstimate>${v(j.hoursEstimate ?? '0')}</HoursEstimate>\n`;
    xml += `          <ValueCPAEstimate>${v(j.valueCpaEstimate ?? '0')}</ValueCPAEstimate>\n`;
    xml += `          <CustomerStates>${v(j.customerStates)}</CustomerStates>\n`;
    xml += `          <SAInstruction>${v(j.saInstruction)}</SAInstruction>\n          <JobAction>W</JobAction>\n`;
    // Emitted ONLY when an account was selected. Same rule as <EngineNumber>:
    // a blank would risk overwriting whatever Evolve already holds on an
    // UPDATE, and a job with no AR account (cash work) legitimately has none.
    if (String(j.arAccountNo ?? '').trim()) {
      xml += `          <ARAccountNo>${v(j.arAccountNo)}</ARAccountNo>\n`;
    }
    xml += `        </RowDetails>\n`;
  }
  xml += `      </ROJobHeader>\n`;
  return xml;
}

export interface RoMaintenanceResult {
  success: boolean;
  requestStatus: string | null;
  rowStatus: string | null;
  roNumber: string | null;        // Evolve DMSReferenceNo (authoritative RONumber)
  crmReferenceNo: string | null;  // echoed correlation ref
  message: string | null;
  rawXml: string;
}

// Exported for unit testing (same convention as renderRoJobHeaderRows above).
// Pure string rendering — no DB, no network, no Evolve call.
export function buildRoMaintenanceXml(p: RoMaintenanceInput): string {
  const trackingId = uuidv4();
  const dateTime   = formatDateTime();
  const v = (x: unknown) => escapeXml(String(x ?? ''));
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n<Integration>\n  <Action>\n`;
  xml += `    <Function Type="Request">IRM_ROMaintenance</Function>\n    <Version>1</Version>\n`;
  xml += `    <SourceSystem>${escapeXml(env.EVOLVE_SOURCE_SYSTEM)}</SourceSystem>\n`;
  xml += `    <TargetSystem>${escapeXml(env.EVOLVE_TARGET_SYSTEM)}</TargetSystem>\n`;
  xml += `    <MessageCreator>${escapeXml(env.EVOLVE_MESSAGE_CREATOR)}</MessageCreator>\n`;
  xml += `    <MessageCreationDateTime>${dateTime}</MessageCreationDateTime>\n`;
  xml += `    <MessageTrackingIdentifier>${trackingId}</MessageTrackingIdentifier>\n`;
  xml += `    <InterfaceCode>${escapeXml(p.interfaceCode || env.EVOLVE_INTERFACE_CODE)}</InterfaceCode>\n`;
  xml += `  </Action>\n  <Request>\n    <RowDetails>\n      <RowID>01</RowID>\n      <ROMaintenance>\n`;
  xml += `        <CRMReferenceNo>${v(p.crmReferenceNo)}</CRMReferenceNo>\n`;
  xml += `        <RONumber>${v(p.roNumber)}</RONumber>\n`;
  xml += `        <RegistrationNo>${v(p.registrationNo)}</RegistrationNo>\n`;
  xml += `        <VehVinNumber>${v(p.vin)}</VehVinNumber>\n`;
  // EngineNumber is emitted ONLY when we hold one. Previously it was always
  // written, so a job card with no engine number sent
  // <EngineNumber></EngineNumber> — and on an UPDATE that blank can overwrite a
  // value Evolve already holds. Evolve refuses to load a labour line under Cost
  // Jobs when Engine No is blank, so that overwrite is costly. Omitting the
  // element leaves Evolve's existing value untouched. It is NOT added to
  // MANDATORY_FIELDS: that would park existing job cards that legitimately have
  // no engine number yet.
  if (String(p.engineNumber ?? '').trim()) {
    xml += `        <EngineNumber>${v(p.engineNumber)}</EngineNumber>\n`;
  }
  xml += `        <ModelYear>${v(p.modelYear)}</ModelYear>\n`;
  xml += `        <OwnerCustSequenceID>${v(p.ownerCustSequenceId)}</OwnerCustSequenceID>\n`;
  xml += `        <DriverCustSequenceID>${v(p.ownerCustSequenceId)}</DriverCustSequenceID>\n`;
  xml += `        <ContactTodayTelNumber>OC</ContactTodayTelNumber>\n`;
  xml += `        <Make>${v(p.make)}</Make>\n        <ModelCode>${v(p.modelCode)}</ModelCode>\n`;
  xml += `        <ModelDescription>${v(p.modelDescription)}</ModelDescription>\n`;
  // Contract position: 15a places <RegistrationDate> between <ModelCode> and
  // <OdoIn>. Emitted only when present (see RoMaintenanceInput).
  if (String(p.registrationDate ?? '').trim()) {
    xml += `        <RegistrationDate>${v(p.registrationDate)}</RegistrationDate>\n`;
  }
  xml += `        <OdoIn>${v(p.odoIn ?? 0)}</OdoIn>\n`;
  xml += `        <CustomerWaiting>f</CustomerWaiting>\n        <LoanVehicle>f</LoanVehicle>\n`;
  xml += `        <DropOff>f</DropOff>\n        <PartsClaim>f</PartsClaim>\n        <CSIConsentGiven>no</CSIConsentGiven>\n`;
  xml += `        <AppointmentDate>${v(p.appointmentDate)}</AppointmentDate>\n`;
  // Contract position: 15a places <SellingDealer> just before <FranchiseSeqID>.
  // Emitted only when present. NOTE: <SellingDealer> appears in 15a but NOT in
  // the 15b variant — confirm against the deployed Evolve version.
  if (String(p.sellingDealer ?? '').trim()) {
    xml += `        <SellingDealer>${v(p.sellingDealer)}</SellingDealer>\n`;
  }
  // AI-3: FranchiseSeqID / ServiceDept flow from the sync layer's franchise
  // resolver when a mapping is supplied. The '1' defaults are retained as the
  // proven current behaviour and stay in effect until the client provides the
  // per-franchise values + Make→Franchise rule (see resolveRoFranchise). Do NOT
  // hardcode franchise values here.
  xml += `        <FranchiseSeqID>${v(p.franchiseSeqId ?? '1')}</FranchiseSeqID>\n`;
  xml += `        <ServiceDept>${v(p.serviceDept ?? '1')}</ServiceDept>\n`;
  xml += `        <ServiceAdvisorNumber>${v(p.serviceAdvisorNumber ?? '1')}</ServiceAdvisorNumber>\n`;
  xml += `        <ROStatus>${v(p.roStatus ?? 'WIP')}</ROStatus>\n        <ROStatusType>${v(p.roStatusType ?? 'W')}</ROStatusType>\n`;
  xml += `      </ROMaintenance>\n`;
  // AI-1: <JobType> carries the job card's selected Job Type code when present;
  // 'INT' remains the safe default for historical / unset job cards. The set of
  // valid codes (Cash / CST / ESC / Warranty → codes) comes from the job_types
  // lookup cache once populated.
  // TODO(AI-1 / client): confirm the exact Evolve JobType codes + the default to
  // use when a job card has no Job Type. Until then this default stays 'INT'.
  //
  // Multi-job: when the caller supplies jobs[], emit one <RowDetails> per job
  // (per-job CustomerStates/SAInstruction). Otherwise emit the single legacy
  // block from the flat fields — identical byte-for-byte to the prior output.
  const jobRows: RoJobHeaderJob[] = (p.jobs && p.jobs.length)
    ? p.jobs
    : [{
        jobNumber: '01',
        jobType: p.jobType ?? 'INT',
        serviceType: p.serviceType ?? 'S06',
        hoursEstimate: p.hoursEstimate ?? '0',
        valueCpaEstimate: p.valueCpaEstimate ?? '0',
        customerStates: p.customerStates,
        saInstruction: p.saInstruction,
        // Carried through so the AR account still reaches Evolve when multi-job
        // is off (the default) — renderRoJobHeaderRows omits it when blank.
        ...(String(p.arAccountNo ?? '').trim() ? { arAccountNo: p.arAccountNo } : {}),
      }];
  xml += renderRoJobHeaderRows(jobRows);
  // Technician labour lines (PostingType=L). Emitted only when the caller supplies
  // them (labour emission enabled + lines resolved); rendered by the pure module.
  xml += renderRoJobDetailsXml(p.jobDetails ?? []);
  xml += `    </RowDetails>\n  </Request>\n</Integration>`;
  return xml;
}

function parseRoMaintenanceResponse(rawXml: string): RoMaintenanceResult {
  const base: RoMaintenanceResult = { success:false, requestStatus:null, rowStatus:null, roNumber:null, crmReferenceNo:null, message:null, rawXml };
  let parsed: any;
  try { parsed = xmlParser.parse(rawXml); } catch { return base; }
  const integration   = parsed?.Integration ?? parsed;
  const result        = integration?.Result;
  const requestStatus = result?.RequestStatus != null ? String(result.RequestStatus).trim() : null;
  let row = integration?.Response?.RowDetails;
  if (Array.isArray(row)) row = row[0];
  const flat = row && typeof row === 'object' ? flattenToStrings(row) : {};
  const rowStatus      = flat.RowStatus ?? null;
  const roNumber       = flat.DMSReferenceNo ?? null;   // Evolve's RONumber
  const crmReferenceNo = flat.CRMReferenceNo ?? null;
  const message        = flat.RowDetailedMessage
    ?? (result?.RequestStatusMessage != null ? String(result.RequestStatusMessage).trim() : null);
  const success = requestStatus === 'S' && (rowStatus === 'S' || rowStatus === 'W');
  return { success, requestStatus, rowStatus, roNumber, crmReferenceNo, message, rawXml };
}

export async function roMaintenance(p: RoMaintenanceInput): Promise<RoMaintenanceResult> {
  assertEvolveWriteAllowed('IRM_ROMaintenance');
  console.log(`[IRM] ROMaintenance ${p.roNumber ? 'UPDATE RONumber=' + p.roNumber : 'CREATE'} → ROStatus=${p.roStatus ?? 'WIP'}/${p.roStatusType ?? 'W'}`);
  const xmlRequest = buildRoMaintenanceXml(p);
  const MAX_ATTEMPTS = 2;
  let lastRawXml = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 500 * (attempt - 1) ** 2));
    let res: { status: number; headers: Headers; body: string };
    try {
      res = await evolveHttpPost(xmlRequest, 'ROMaintenance');
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isTransientTransportError(err)) {
        console.log(`[IRM] ROMaintenance ${classifyTransportError(err)} on attempt ${attempt}, retrying...`);
        continue;
      }
      throw err;
    }
    lastRawXml = res.body;
    if (res.status < 200 || res.status >= 300) {
      // Retry 5xx within the existing budget (prior behaviour); never retry 4xx.
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) continue;
      throw httpError('ROMaintenance', res.status, lastRawXml);
    }
    if (attempt < MAX_ATTEMPTS && isTransientEvolveFailure(lastRawXml)) {
      console.log(`[IRM] ROMaintenance transient failure on attempt ${attempt}, retrying...`);
      continue;
    }
    const parsed = parseRoMaintenanceResponse(lastRawXml);
    if (!parsed.success) {
      console.warn(
        `[IRM] ROMaintenance ${classifyEvolveResult(parsed.requestStatus, parsed.rowStatus)}: ` +
        `requestStatus=${parsed.requestStatus} rowStatus=${parsed.rowStatus} msg=${parsed.message}`,
      );
    }
    return parsed;
  }
  return parseRoMaintenanceResponse(lastRawXml);
}

// ─── Part Info Lookup (READ a part from Evolve) ─────────────────────────────
// IRM_PartInfoLookup is an EXACT part-number lookup. The request nests
// <RequestInfo> (Type + ServiceDepartment) and <Parts><PartNumber>, exactly as
// the apitest harness proved; the flat buildXmlRequest above cannot nest, so we
// hand-roll the body with nestedObjectToXml (same approach as CustomerMaintenance).
// The response payload is a single <PartDetail> under <Response> (fields
// PART_NUMBER, PART_DESCRIPTION, PRICE, COST, QUANTITY, BIN, FRANCHISE, …).

export interface EvolvePartInfo {
  partCode: string;
  partName: string;
  unitPrice: number;
}

// Discriminated outcome, matching IrmSearchResult / RoHistoryLookupResult:
//   FOUND       — Evolve returned a valid part.
//   NOT_FOUND   — Evolve answered authoritatively with no matching part.
//   UNAVAILABLE — the lookup could not be completed (timeout / network / HTTP /
//                 parse failure). Callers fall back to the local table in BOTH
//                 the NOT_FOUND and UNAVAILABLE cases; the split exists so the
//                 caller can log the two situations differently.
export type PartInfoLookupResult =
  | { outcome: 'FOUND'; part: EvolvePartInfo }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'UNAVAILABLE' };

export interface LookupPartInfoParams {
  // Per-company Evolve InterfaceCode override; falls back to env when omitted.
  interfaceCode?: string;
}

function buildPartInfoXml(partNumber: string, interfaceCode?: string): string {
  const trackingId = uuidv4();
  const dateTime   = formatDateTime();

  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<Integration>\n`;
  xml += `  <Action>\n`;
  xml += `    <Function Type="Request">IRM_PartInfoLookup</Function>\n`;
  xml += `    <Version>1</Version>\n`;
  xml += `    <SourceSystem>${escapeXml(env.EVOLVE_SOURCE_SYSTEM)}</SourceSystem>\n`;
  xml += `    <TargetSystem>${escapeXml(env.EVOLVE_TARGET_SYSTEM)}</TargetSystem>\n`;
  xml += `    <MessageCreator>${escapeXml(env.EVOLVE_MESSAGE_CREATOR)}</MessageCreator>\n`;
  xml += `    <MessageCreationDateTime>${dateTime}</MessageCreationDateTime>\n`;
  xml += `    <MessageTrackingIdentifier>${trackingId}</MessageTrackingIdentifier>\n`;
  xml += `    <InterfaceCode>${escapeXml(interfaceCode || env.EVOLVE_INTERFACE_CODE)}</InterfaceCode>\n`;
  xml += `  </Action>\n`;
  xml += `  <Request>\n`;
  xml += nestedObjectToXml({
    RequestInfo: {
      Type:              env.EVOLVE_PART_LOOKUP_TYPE,
      ServiceDepartment: env.EVOLVE_PART_LOOKUP_SERVICE_DEPT,
    },
    Parts: { PartNumber: partNumber },
  }, '    ');
  xml += `  </Request>\n`;
  xml += `</Integration>`;
  return xml;
}

// Evolve PRICE values may use a comma decimal separator (e.g. "0,613"); normalise
// before Number() so a comma-formatted price does not parse to NaN.
function parseEvolveNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parsePartInfoResponse(rawXml: string): PartInfoLookupResult {
  let parsed: any;
  try {
    parsed = xmlParser.parse(rawXml);
  } catch {
    return { outcome: 'UNAVAILABLE' }; // unparseable → treat as could-not-complete
  }

  const integration = parsed?.Integration ?? parsed;
  const requestStatus = integration?.Result?.RequestStatus;

  // Payload part row (Evolve returns a single <PartDetail>; guard for an array).
  let detail = integration?.Response?.PartDetail;
  if (Array.isArray(detail)) detail = detail[0];
  const flat = detail && typeof detail === 'object' ? flattenToStrings(detail) : {};
  const partCode = flat.PART_NUMBER ?? '';

  // FOUND requires an 'S' status AND a part row carrying a part number. Anything
  // else (non-'S', or 'S' with no PartDetail) is an authoritative NOT_FOUND.
  if (String(requestStatus ?? '').trim() === 'S' && partCode) {
    return {
      outcome: 'FOUND',
      part: {
        partCode,
        partName:  flat.PART_DESCRIPTION ?? '',
        unitPrice: parseEvolveNumber(flat.PRICE),
      },
    };
  }
  return { outcome: 'NOT_FOUND' };
}

/**
 * Look up a single part by EXACT part number in Evolve (IRM_PartInfoLookup).
 * Never throws. A transport/HTTP/parse failure returns UNAVAILABLE so the caller
 * can fall back to the local catalogue without failing the request.
 */
export async function lookupPartInfo(
  partNumber: string,
  params: LookupPartInfoParams = {},
): Promise<PartInfoLookupResult> {
  const xml = buildPartInfoXml(partNumber, params.interfaceCode);
  try {
    const body = await postEvolveXml(xml, 'PartInfoLookup');
    return parsePartInfoResponse(body);
  } catch (err) {
    console.error(`[IRM] lookupPartInfo failed: ${(err as Error)?.message ?? err}`);
    return { outcome: 'UNAVAILABLE' };
  }
}

// ─── Model-code resolution ──────────────────────────────────────────────────
// MOVED OUT of the transport layer. ModelCode resolution now lives in
// modelCodeResolver.service.ts (catalog read-only, no first-code fallback) and
// catalog population lives in the warm job / vehicles picker. This file stays
// DB-free and Evolve-transport-only.
