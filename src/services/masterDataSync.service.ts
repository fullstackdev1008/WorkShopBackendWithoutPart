import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { db } from '../db';
import {
  vehicleMakes,
  vehicleModels,
  vehicleConditions,
  vehicleColours,
  provinces,
  serviceTypes,
  roStatuses,
  serviceAdvisors,
  franchiseServiceDepartments,
} from '../db/models';
import { parseActiveTechniciansFromRows, EvolveTechnician } from './evolveTechnician';
import { parseActiveServiceAdvisorsFromRows, EvolveServiceAdvisor } from './evolveServiceAdvisor';
import { postEvolveXml } from './evolveIrm.service';

// Re-export so existing importers (user-management) keep their import path.
export type { EvolveTechnician };
export type { EvolveServiceAdvisor };

// ─── XML Helpers ─────────────────────────────────────────────────────────────

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
 * @param interfaceCode Overrides the env default so a lookup can be fetched for
 *   a specific company (10EC / 20EC). Omitted → env.EVOLVE_INTERFACE_CODE,
 *   i.e. exactly today's behaviour.
 */
export function buildXmlRequest(
  functionName: string,
  requestBody: Record<string, string>,
  interfaceCode?: string,
): string {
  const trackingId = uuidv4();
  const dateTime = formatDateTime();

  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<Integration>\n`;
  xml += `  <Action>\n`;
  xml += `    <Function Type="Request">${escapeXml(functionName)}</Function>\n`;
  xml += `    <Version>1</Version>\n`;
  xml += `    <SourceSystem>${escapeXml(env.EVOLVE_SOURCE_SYSTEM)}</SourceSystem>\n`;
  xml += `    <TargetSystem>${escapeXml(env.EVOLVE_TARGET_SYSTEM)}</TargetSystem>\n`;
  xml += `    <MessageCreator>${escapeXml(env.EVOLVE_MESSAGE_CREATOR)}</MessageCreator>\n`;
  xml += `    <MessageCreationDateTime>${dateTime}</MessageCreationDateTime>\n`;
  xml += `    <MessageTrackingIdentifier>${trackingId}</MessageTrackingIdentifier>\n`;
  xml += `    <InterfaceCode>${escapeXml(interfaceCode || env.EVOLVE_INTERFACE_CODE)}</InterfaceCode>\n`;
  xml += `  </Action>\n`;
  xml += `  <Request>\n`;

  for (const [key, value] of Object.entries(requestBody)) {
    xml += `    <${key}>${escapeXml(String(value))}</${key}>\n`;
  }

  xml += `  </Request>\n`;
  xml += `</Integration>`;

  return xml;
}


function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return {
      name: err.name,
      message: err.message,
      code: (err as { code?: string }).code,
      cause:
        cause instanceof Error
          ? {
              name: cause.name,
              message: cause.message,
              code: (cause as { code?: string }).code,
            }
          : cause,
    };
  }
  return { value: String(err) };
}

// Delegates to the hardened shared transport (evolveIrm.postEvolveXml): redacted
// debug logging, transport-error classification, transient retry, non-2xx throw,
// and AbortSignal timeout. Signature is unchanged so all callers are unaffected.
async function callEvolveApi(xmlRequest: string, functionName = 'unknown'): Promise<string> {
  return postEvolveXml(xmlRequest, functionName);
}

function isSuccessResponse(xml: string): boolean {
  const match = xml.match(/<RequestStatus>([^<]*)<\/RequestStatus>/i);
  const status = match ? match[1].trim().toLowerCase() : '';
  return status === 's' || status === 'success';
}

/**
 * Extract the inner content of the first matching XML tag.
 */
function extractBlock(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract all <RowDetails> blocks within an XML string, returning each as a
 * flat key→value map of its leaf fields.
 */
function extractAllRows(xml: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const rowRegex = /<RowDetails>([\s\S]*?)<\/RowDetails>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const fields: Record<string, string> = {};
    const leafRegex = /<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g;
    let leaf;
    while ((leaf = leafRegex.exec(rowMatch[1])) !== null) {
      fields[leaf[1]] = leaf[2].trim();
    }
    if (Object.keys(fields).length > 0) rows.push(fields);
  }

  return rows;
}

/**
 * Map one Evolve FranchiseServiceDepartments <RowDetails> into the cache shape.
 * Extracted as a pure, exported helper so the label-capture logic (the source of
 * the AI-3 "franchise showed as null" bug) is unit-testable. Evolve misspells the
 * franchise tag as "Franshise"; the correct spelling is tolerated too. Blank /
 * whitespace-only names normalise to null so unlabeled pairs stay hidden from the
 * job-card dropdowns.
 */
export function mapFranchiseServiceDepartmentRow(r: Record<string, string>): {
  franchiseSeqId: string;
  sdNumber: string;
  franchiseLabel: string | null;
  serviceDeptLabel: string | null;
} {
  return {
    franchiseSeqId: (r.FranchiseSeqID ?? '').trim(),
    sdNumber: (r.SDNumber ?? '').trim(),
    franchiseLabel: (r.Franshise ?? r.Franchise ?? '').trim() || null,
    serviceDeptLabel: (r.SDName ?? '').trim() || null,
  };
}

// ─── Evolve API Calls ─────────────────────────────────────────────────────────

interface LookupFields {
  Makes?: boolean;
  VehicleConditions?: boolean;
  ExtIntColours?: boolean;
  Provinces?: boolean;
  ServiceTypes?: boolean;
  ROStatuses?: boolean;
  ServiceAdvisors?: boolean;
  FranchiseServiceDepartments?: boolean; // AI-3
}

interface ParsedLookupData {
  makes: Array<{ code: string; description: string }>;
  conditions: Array<{ code: string; description: string }>;
  colours: Array<{ code: string; description: string; type: string }>;
  provinces: Array<{ code: string; name: string }>;
  serviceTypes: Array<{ code: string; name: string }>;
  roStatuses: Array<{ code: string; name: string }>;
  serviceAdvisors: Array<{ advisorCode: string; name: string }>;
  // AI-3 — FranchiseSeqID + SDNumber plus the labels Evolve returns on the live
  // response (Franshise [sic] + SDName), used to auto-populate the job-card
  // Franchise / Service-Dept dropdowns without manual labeling.
  franchiseServiceDepartments: Array<{
    franchiseSeqId: string;
    sdNumber: string;
    franchiseLabel: string | null;
    serviceDeptLabel: string | null;
  }>;
}

/**
 * Call IRM_GetLookupDropdownTables with the requested fields and return
 * parsed arrays for each entity type.
 *
 * NOTE: Field names below reflect the Evolve XML response structure.
 * If the API returns different tag names (e.g. ConditionID vs ConditionCode),
 * update the mapping keys here accordingly after inspecting a live response.
 */
export async function fetchLookupTables(
  fields: LookupFields = {},
  interfaceCode?: string,
): Promise<ParsedLookupData> {
  const requestBody: Record<string, string> = {
    CityAreaCodes: 'no',
    Provinces: fields.Provinces ? 'yes' : 'no',
    SalesReps: 'no',
    SalesManagers: 'no',
    FIManagers: 'no',
    FIAccessories: 'no',
    Accessories: 'no',
    FIDealInsurances: 'no',
    ExtendedMaintenanceContracts: 'no',
    Categories: 'no',
    Makes: fields.Makes ? 'yes' : 'no',
    ModelCodes: 'no',
    VehicleConditions: fields.VehicleConditions ? 'yes' : 'no',
    PurchaseTranCodes: 'no',
    DefaultTaxCodes: 'no',
    ExtIntColours: fields.ExtIntColours ? 'yes' : 'no',
    FranchiseServiceDepartments: fields.FranchiseServiceDepartments ? 'yes' : 'no', // AI-3
    ServiceAdvisors: fields.ServiceAdvisors ? 'yes' : 'no',
    ROStatuses: fields.ROStatuses ? 'yes' : 'no',
    ServiceTypes: fields.ServiceTypes ? 'yes' : 'no',
    Teams: 'no',
    Locations: 'no',
    APAccountTypes: 'no',
    ARAccountTypes: 'no',
  };

  const xml = buildXmlRequest('IRM_GetLookupDropdownTables', requestBody, interfaceCode);
  const rawXml = await callEvolveApi(xml, 'IRM_GetLookupDropdownTables');


  if (!isSuccessResponse(rawXml)) {
    throw new Error('Evolve API returned a non-success status for IRM_GetLookupDropdownTables');
  }

  const responseBlock = extractBlock(rawXml, 'Response') ?? '';

  // Makes → MakeCode, MakeDescription
  const makesBlock = extractBlock(responseBlock, 'Makes') ?? '';
  const makes = extractAllRows(makesBlock)
    .map((r) => ({ code: r.MakeCode ?? '', description: r.MakeDescription ?? r.MakeCode ?? '' }))
    .filter((m) => m.code);

  // VehicleConditions → ConditionCode, ConditionDescription
  const conditionsBlock = extractBlock(responseBlock, 'VehicleConditions') ?? '';
  const conditions = extractAllRows(conditionsBlock)
    .map((r) => ({ code: r.ConditionCode ?? '', description: r.ConditionDescription ?? r.ConditionCode ?? '' }))
    .filter((c) => c.code);

  // ExtIntColours → ColourCode, ColourDescription, ColourType (EXT|INT)
  const coloursBlock = extractBlock(responseBlock, 'ExtIntColours') ?? '';
  const colours = extractAllRows(coloursBlock)
    .map((r) => ({
      code: r.ColourCode ?? '',
      description: r.ColourDescription ?? r.ColourCode ?? '',
      type: r.ColourType ?? 'EXT',
    }))
    .filter((c) => c.code);

  // Provinces → ProvinceCode, ProvinceName
  const provincesBlock = extractBlock(responseBlock, 'Provinces') ?? '';
  const parsedProvinces = extractAllRows(provincesBlock)
    .map((r) => ({ code: r.ProvinceCode ?? '', name: r.ProvinceName ?? r.ProvinceCode ?? '' }))
    .filter((p) => p.code);

  // ServiceTypes → ServiceTypeCode, ServiceTypeName
  const serviceTypesBlock = extractBlock(responseBlock, 'ServiceTypes') ?? '';
  const parsedServiceTypes = extractAllRows(serviceTypesBlock)
    .map((r) => ({ code: r.ServiceTypeCode ?? '', name: r.ServiceTypeName ?? r.ServiceTypeCode ?? '' }))
    .filter((s) => s.code);

  // ROStatuses → ROStatusCode, ROStatusName
  const roStatusesBlock = extractBlock(responseBlock, 'ROStatuses') ?? '';
  const parsedRoStatuses = extractAllRows(roStatusesBlock)
    .map((r) => ({ code: r.ROStatusCode ?? '', name: r.ROStatusName ?? r.ROStatusCode ?? '' }))
    .filter((s) => s.code);

  // ServiceAdvisors → AdvisorCode, AdvisorName
  const serviceAdvisorsBlock = extractBlock(responseBlock, 'ServiceAdvisors') ?? '';
  const parsedServiceAdvisors = extractAllRows(serviceAdvisorsBlock)
    .map((r) => ({ advisorCode: r.AdvisorCode ?? '', name: r.AdvisorName ?? '' }))
    .filter((s) => s.advisorCode);

  // FranchiseServiceDepartments → FranchiseSeqID, SDNumber (AI-3).
  // CONFIRMED FIELD NAMES ONLY (per the apitest 14b schema annotations:
  //   Table: FranchiseServiceDepartments — Field: FranchiseSeqID / SDNumber).
  // STRUCTURE NOT YET VERIFIED AGAINST A POPULATED LIVE RESPONSE: this reuses the
  // same <RowDetails> extractor as every other block, but it is FAIL-SAFE — if
  // the live response does not use <RowDetails> or lacks these tags, extractAllRows
  // yields nothing and we persist nothing (no wrong data, no crash). The raw
  // response is logged above ("fetchLookupTables ~ rawXml"), so the first live
  // `yes` fetch can be used to confirm the wrapper + reveal any extra columns.
  // TODO(AI-3): once a populated response is confirmed, (a) lock this parser to
  // the verified structure and (b) if a franchise-name/brand/make column is
  // present, add it here + to the cache so resolveRoFranchise() can select the
  // correct pair deterministically. Do NOT add such a column on assumption.
  // Live response row shape (confirmed against production 20EC):
  //   <Franshise>Other</Franshise>          ← franchise label (Evolve's spelling)
  //   <FranchiseSeqID>1</FranchiseSeqID>     ← RO <FranchiseSeqID>
  //   <SDName>Service - TATA</SDName>        ← service-dept label
  //   <SDNumber>1</SDNumber>                 ← RO <ServiceDept>
  const franchiseServiceDepartmentsBlock = extractBlock(responseBlock, 'FranchiseServiceDepartments') ?? '';
  const parsedFranchiseServiceDepartments = extractAllRows(franchiseServiceDepartmentsBlock)
    .map(mapFranchiseServiceDepartmentRow)
    .filter((f) => f.franchiseSeqId && f.sdNumber);

  return {
    makes,
    conditions,
    colours,
    provinces: parsedProvinces,
    serviceTypes: parsedServiceTypes,
    roStatuses: parsedRoStatuses,
    serviceAdvisors: parsedServiceAdvisors,
    franchiseServiceDepartments: parsedFranchiseServiceDepartments,
  };
}

// ─── Technicians (read-only; for admin mapping → users.evolveTechnicianNo) ─────

/**
 * Fetch the list of ACTIVE Evolve technicians via IRM_GetLookupDropdownTables
 * (Technicians=yes). Parsing/filtering lives in the pure evolveTechnician module
 * (unit-tested); this wrapper does only the I/O. Read-only: no DB writes here
 * (the admin mapping step persists the chosen TechnicianNo onto the user).
 *
 * Request body is the minimal confirmed-working form (only Technicians=yes),
 * matching the envelope the Evolve team verified.
 */
export async function fetchActiveTechnicians(): Promise<EvolveTechnician[]> {
  const xml = buildXmlRequest('IRM_GetLookupDropdownTables', { Technicians: 'yes' });
  const rawXml = await callEvolveApi(xml, 'IRM_GetLookupDropdownTables(Technicians)');

  if (!isSuccessResponse(rawXml)) {
    throw new Error('Evolve API returned a non-success status for IRM_GetLookupDropdownTables (Technicians)');
  }

  const responseBlock = extractBlock(rawXml, 'Response') ?? rawXml;
  const techniciansBlock = extractBlock(responseBlock, 'Technicians') ?? '';
  return parseActiveTechniciansFromRows(extractAllRows(techniciansBlock));
}

/**
 * Fetch the ACTIVE Evolve service advisors live (ServiceAdvisors=yes) for the
 * admin mapping step (persists the chosen SANumber onto the user →
 * users.evolve_sa_number → RO <ServiceAdvisorNumber>). Mirrors
 * fetchActiveTechnicians; parsing/filtering lives in the pure module.
 */
export async function fetchActiveServiceAdvisors(): Promise<EvolveServiceAdvisor[]> {
  const xml = buildXmlRequest('IRM_GetLookupDropdownTables', { ServiceAdvisors: 'yes' });
  const rawXml = await callEvolveApi(xml, 'IRM_GetLookupDropdownTables(ServiceAdvisors)');

  if (!isSuccessResponse(rawXml)) {
    throw new Error('Evolve API returned a non-success status for IRM_GetLookupDropdownTables (ServiceAdvisors)');
  }

  const responseBlock = extractBlock(rawXml, 'Response') ?? rawXml;
  const advisorsBlock = extractBlock(responseBlock, 'ServiceAdvisors') ?? '';
  return parseActiveServiceAdvisorsFromRows(extractAllRows(advisorsBlock));
}

/**
 * Call IRM_GetSeriesData for a single make code.
 * Returns series rows → SeriesCode, SeriesDescription.
 */
export async function fetchSeriesForMake(makeCode: string): Promise<Array<{ code: string; name: string }>> {
  const xml = buildXmlRequest('IRM_GetSeriesData', { Make: makeCode });
  const rawXml = await callEvolveApi(xml, `IRM_GetSeriesData(${makeCode})`);

  if (!isSuccessResponse(rawXml)) return [];

  const responseBlock = extractBlock(rawXml, 'Response') ?? rawXml;

  // The IRM_GetSeriesData response lists each model as
  //   <Series><SeriesName>500</SeriesName></Series>
  // — there is no series code, only the name. Parse the SeriesName values
  // directly and use the name as both code and name. Dedupe to guard against
  // repeated rows.
  const names = [...responseBlock.matchAll(/<SeriesName>([^<]*)<\/SeriesName>/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);

  return [...new Set(names)].map((n) => ({ code: n, name: n }));
}

/**
 * Call IRM_GetModelCodes for a single (Make, Series) pair — the third tier of
 * the Evolve hierarchy (Make → Series → ModelCode).
 *
 * The response lists each model as:
 *   <Model>
 *     <ModelCode>20015050</ModelCode>
 *     <MandMCode>20015050</MandMCode>
 *     <ModelDescription>1.2 16V ACTIVE 5Dr</ModelDescription>
 *     <ModelYear>2004</ModelYear>
 *   </Model>
 * The same ModelCode/description repeats once per ModelYear, so we dedupe to
 * one entry per code (year is captured separately on the vehicle).
 */
export async function fetchModelCodesForSeries(
  makeCode: string,
  seriesName: string,
): Promise<Array<{ code: string; mandmCode: string | null; description: string | null; year: number | null }>> {
  const xml = buildXmlRequest('IRM_GetModelCodes', { Make: makeCode, Series: seriesName });
  const rawXml = await callEvolveApi(xml, `IRM_GetModelCodes(${makeCode}/${seriesName})`);

  if (!isSuccessResponse(rawXml)) return [];

  const responseBlock = extractBlock(rawXml, 'Response') ?? rawXml;

  // Keep every <Model> row in full. Dedupe only on the exact (code, year)
  // key so a single insert batch can't try to upsert the same unique row
  // twice (Postgres rejects that within one statement).
  const seen = new Set<string>();
  const rows: Array<{ code: string; mandmCode: string | null; description: string | null; year: number | null }> = [];
  const modelRegex = /<Model>([\s\S]*?)<\/Model>/gi;
  let match;
  while ((match = modelRegex.exec(responseBlock)) !== null) {
    const block = match[1];
    const code = (block.match(/<ModelCode>([^<]*)<\/ModelCode>/i)?.[1] ?? '').trim();
    if (!code) continue;
    const mandmCode = (block.match(/<MandMCode>([^<]*)<\/MandMCode>/i)?.[1] ?? '').trim() || null;
    const description = (block.match(/<ModelDescription>([^<]*)<\/ModelDescription>/i)?.[1] ?? '').trim() || null;
    const yearRaw = (block.match(/<ModelYear>([^<]*)<\/ModelYear>/i)?.[1] ?? '').trim();
    const yearNum = Number(yearRaw);
    const year = Number.isFinite(yearNum) && yearNum > 0 ? yearNum : null;

    const key = `${code}|${year ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ code, mandmCode, description, year });
  }

  return rows;
}

// ─── Sync Functions ───────────────────────────────────────────────────────────

export async function syncMakes(
  makes: Array<{ code: string; description: string }>,
): Promise<number> {
  if (!makes.length) return 0;

  await db
    .insert(vehicleMakes)
    .values(makes.map((m) => ({ name: m.description || m.code, code: m.code })))
    .onConflictDoUpdate({
      target: vehicleMakes.name,
      set: { code: sql`excluded.code`, updatedAt: new Date() },
    });

  return makes.length;
}

export async function syncModels(
  makes: Array<{ code: string; description: string }>,
): Promise<number> {
  let total = 0;

  for (const make of makes) {
    // Resolve the local UUID for this make
    const [dbMake] = await db
      .select({ id: vehicleMakes.id })
      .from(vehicleMakes)
      .where(eq(vehicleMakes.name, make.description || make.code))
      .limit(1);

    if (!dbMake) continue;

    const series = await fetchSeriesForMake(make.code);
    if (!series.length) continue;

    await db
      .insert(vehicleModels)
      .values(series.map((s) => ({ makeId: dbMake.id, name: s.name })))
      .onConflictDoUpdate({
        target: [vehicleModels.makeId, vehicleModels.name],
        set: { updatedAt: new Date() },
      });

    total += series.length;
  }

  return total;
}

/**
 * @param companyId Scopes the FranchiseServiceDepartments rows to a company —
 *   pass it whenever `data` was fetched with that company's InterfaceCode.
 *   Omitted → rows are written unscoped (company_id NULL), which is the
 *   pre-existing single-company behaviour. Only the franchise cache is
 *   company-scoped; the other lookups (colours, provinces, …) are shared.
 */
export async function syncOtherTables(
  data: ParsedLookupData,
  companyId?: string,
): Promise<{
  conditions: number;
  colours: number;
  provinces: number;
  serviceTypes: number;
  roStatuses: number;
  serviceAdvisors: number;
  franchiseServiceDepartments: number;
}> {
  const result = { conditions: 0, colours: 0, provinces: 0, serviceTypes: 0, roStatuses: 0, serviceAdvisors: 0, franchiseServiceDepartments: 0 };

  if (data.conditions.length) {
    await db
      .insert(vehicleConditions)
      .values(data.conditions)
      .onConflictDoUpdate({
        target: vehicleConditions.code,
        set: { description: sql`excluded.description`, updatedAt: new Date() },
      });
    result.conditions = data.conditions.length;
  }

  if (data.colours.length) {
    await db
      .insert(vehicleColours)
      .values(data.colours)
      .onConflictDoUpdate({
        target: [vehicleColours.code, vehicleColours.type],
        set: { description: sql`excluded.description`, updatedAt: new Date() },
      });
    result.colours = data.colours.length;
  }

  if (data.provinces.length) {
    await db
      .insert(provinces)
      .values(data.provinces)
      .onConflictDoUpdate({
        target: provinces.code,
        set: { name: sql`excluded.name`, updatedAt: new Date() },
      });
    result.provinces = data.provinces.length;
  }

  if (data.serviceTypes.length) {
    await db
      .insert(serviceTypes)
      .values(data.serviceTypes)
      .onConflictDoUpdate({
        target: serviceTypes.code,
        set: { name: sql`excluded.name`, updatedAt: new Date() },
      });
    result.serviceTypes = data.serviceTypes.length;
  }

  if (data.roStatuses.length) {
    await db
      .insert(roStatuses)
      .values(data.roStatuses)
      .onConflictDoUpdate({
        target: roStatuses.code,
        set: { name: sql`excluded.name`, updatedAt: new Date() },
      });
    result.roStatuses = data.roStatuses.length;
  }

  if (data.serviceAdvisors.length) {
    await db
      .insert(serviceAdvisors)
      .values(data.serviceAdvisors)
      .onConflictDoUpdate({
        target: serviceAdvisors.advisorCode,
        set: { name: sql`excluded.name`, updatedAt: new Date() },
      });
    result.serviceAdvisors = data.serviceAdvisors.length;
  }

  // AI-3 — cache the confirmed (FranchiseSeqID, SDNumber) pairs. Only runs when
  // the parser found rows; empty (structure unverified / lookup empty) → no-op.
  // Idempotent upsert on the pair; refreshes is_active so re-sync reactivates.
  if (data.franchiseServiceDepartments.length) {
    await db
      .insert(franchiseServiceDepartments)
      .values(
        data.franchiseServiceDepartments.map((f) => ({ ...f, companyId: companyId ?? null })),
      )
      .onConflictDoUpdate({
        // Two different unique indexes apply (drizzle/0070), and the conflict
        // target must name the right one:
        //   • scoped   → uq_..._company_seq_sd (company_id, franchise, sd)
        //   • unscoped → uq_..._global_seq_sd, PARTIAL on company_id IS NULL.
        // The scoped index cannot serve the unscoped path: Postgres treats
        // NULLs as distinct, so a NULL company_id never conflicts there and the
        // re-sync would insert duplicates (and then trip the partial index).
        // targetWhere supplies the predicate that selects the partial index.
        target: companyId
          ? [
              franchiseServiceDepartments.companyId,
              franchiseServiceDepartments.franchiseSeqId,
              franchiseServiceDepartments.sdNumber,
            ]
          : [franchiseServiceDepartments.franchiseSeqId, franchiseServiceDepartments.sdNumber],
        ...(companyId
          ? {}
          : { targetWhere: sql`${franchiseServiceDepartments.companyId} is null` }),
        // Refresh the Evolve-supplied labels + reactivate on every re-sync so the
        // dropdowns stay in step with Evolve (authoritative source of the names).
        set: {
          isActive: true,
          franchiseLabel: sql`excluded.franchise_label`,
          serviceDeptLabel: sql`excluded.service_dept_label`,
          updatedAt: new Date(),
        },
      });
    result.franchiseServiceDepartments = data.franchiseServiceDepartments.length;
  }

  return result;
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export interface MasterDataSyncResult {
  makes: { synced: number };
  models: { synced: number };
  colours: { synced: number };
  provinces: { synced: number };
  conditions: { synced: number };
  serviceTypes: { synced: number };
  roStatuses: { synced: number };
  serviceAdvisors: { synced: number };
  franchiseServiceDepartments: { synced: number }; // AI-3
}

export async function syncAllMasterData(): Promise<MasterDataSyncResult> {
  const runId = uuidv4();
  const startedAt = Date.now();

  let phase: string = 'fetchLookupTables';
  try {

    const lookup = await fetchLookupTables({
      Makes: true,
      VehicleConditions: true,
      ExtIntColours: true,
      Provinces: true,
      ServiceTypes: true,
      ROStatuses: true,
      ServiceAdvisors: true,
      FranchiseServiceDepartments: true, // AI-3 — fetch + cache the valid (FranchiseSeqID, SDNumber) pairs
    });

    phase = 'syncMakes';
    const makesSynced = await syncMakes(lookup.makes);

    phase = 'syncModels';
    const modelsSynced = await syncModels(lookup.makes);

    phase = 'syncOtherTables';
    const other = await syncOtherTables(lookup);

    const result: MasterDataSyncResult = {
      makes: { synced: makesSynced },
      models: { synced: modelsSynced },
      colours: { synced: other.colours },
      provinces: { synced: other.provinces },
      conditions: { synced: other.conditions },
      serviceTypes: { synced: other.serviceTypes },
      roStatuses: { synced: other.roStatuses },
      serviceAdvisors: { synced: other.serviceAdvisors },
      franchiseServiceDepartments: { synced: other.franchiseServiceDepartments },
    };

    return result;
  } catch (err:any) {
    console.error('[masterDataSync] syncAllMasterData failed:', err);
    throw err;
  }
}
