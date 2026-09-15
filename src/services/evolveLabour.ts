/**
 * Pure (dependency-free) labour-line logic for the Evolve RO sync.
 *
 * Kept free of env/db/network imports so it is unit-testable in isolation (see
 * __tests__/evolveLabour.test.ts), mirroring the modelCodeMatcher ↔ resolver
 * split. The I/O wrappers live in jobCardEvolveSync.service.ts (fetch the rows)
 * and evolveIrm.service.ts (splice the rendered XML into the envelope).
 */

// A single labour line within ROJobDetails. techNo is the resolved Evolve
// TechnicianNo; hours are decimal strings (e.g. "0.25"). LineNumber/LineStatus
// drive idempotent re-sends (N=new, U=update an already-synced line).
export interface RoJobDetailLine {
  lineNumber: string; // e.g. "01"
  jobNumber: string; // matches the ROJobHeader job (e.g. "01")
  lineStatus: string; // N | U | P | D
  techNo: number; // Evolve TechnicianNo → <TechNo>
  hoursWorked: string; // decimal, '.'-formatted
  hoursSold: string; // decimal, '.'-formatted
  details?: string; // job description
}

// A resolved line plus the source item id (needed to persist line bookkeeping
// after a successful sync). itemId is stripped before the line goes on the wire.
export interface ResolvedLabourLine extends RoJobDetailLine {
  itemId: string;
}

// The per-item input to the resolver — the subset of job_card_items (joined to
// users) that labour resolution needs. Plain data so it is trivially testable.
export interface LabourItemRow {
  id: string;
  desc: string | null;
  hoursWorked: string | number | null;
  hoursSold: string | number | null;
  // SA-entered per-job estimate; used as HoursSold when assignment left it blank.
  estimatedHours: string | number | null;
  // 1-based job index → the ROJobHeader job this labour line belongs to.
  jobGroup: number | null;
  evolveLineNumber: number | null;
  evolveTechnicianNo: number | null;
}

export interface LabourLineResolution {
  lines: ResolvedLabourLine[];
  /** Assigned items that could not become a labour line (unmapped tech or missing hours). */
  unresolved: Array<{ itemId: string; reason: 'TECH_UNMAPPED' | 'HOURS_MISSING' }>;
}

// Format a numeric(6,2) hours value as a '.'-decimal string (e.g. "0.25").
// toFixed is locale-independent (always '.'), guarding against any comma-locale
// surprise — Evolve emits comma decimals in responses, so never trust toString().
// Returns null for missing/invalid/negative values (caller treats as unresolved).
export function formatHours(v: string | number | null): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

// Resolve assigned items into Evolve labour lines (PostingType=L). Each item
// maps to one line: the technician's evolve_technician_no becomes <TechNo> and
// hours_worked/hours_sold the decimals. Items whose technician is unmapped or
// whose hours are missing are reported in `unresolved` so the sync layer can
// defer (it must NOT send a blank or zero TechNo). LineNumber is stable: reuse
// the item's persisted number on a re-send (LineStatus=U), otherwise assign
// sequentially (LineStatus=N). Callers pass rows pre-ordered for stable numbering.
export function buildLabourLinesFromItems(rows: LabourItemRow[]): LabourLineResolution {
  const lines: ResolvedLabourLine[] = [];
  const unresolved: LabourLineResolution['unresolved'] = [];
  let nextSeq = 1;

  for (const r of rows) {
    const hoursWorked = formatHours(r.hoursWorked);
    // HoursSold prefers the assignment value; falls back to the SA's per-job
    // estimate so a billed value is present even when assignment left it blank.
    const hoursSold = formatHours(r.hoursSold) ?? formatHours(r.estimatedHours);
    if (r.evolveTechnicianNo == null) {
      unresolved.push({ itemId: r.id, reason: 'TECH_UNMAPPED' });
      continue;
    }
    if (hoursWorked === null || hoursSold === null) {
      unresolved.push({ itemId: r.id, reason: 'HOURS_MISSING' });
      continue;
    }
    const reused = r.evolveLineNumber != null;
    const lineNumber = (reused ? r.evolveLineNumber! : nextSeq).toString().padStart(2, '0');
    if (!reused) nextSeq += 1;
    lines.push({
      itemId: r.id,
      lineNumber,
      // Map the labour line to its real job (multi-job); default '01'.
      jobNumber: String(r.jobGroup ?? 1).padStart(2, '0'),
      lineStatus: reused ? 'U' : 'N',
      techNo: r.evolveTechnicianNo,
      hoursWorked,
      hoursSold,
      details: r.desc ?? '',
    });
  }

  return { lines, unresolved };
}

function escapeXmlValue(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Render the <ROJobDetails> blocks (one per line) spliced into the RO envelope
// after <ROJobHeader>. PostingType is the constant 'L'. Returns '' for no lines.
export function renderRoJobDetailsXml(lines: RoJobDetailLine[]): string {
  let xml = '';
  for (const line of lines) {
    xml += `      <ROJobDetails>\n        <RowDetails>\n`;
    xml += `          <LineNumber>${escapeXmlValue(line.lineNumber)}</LineNumber>\n`;
    xml += `          <JobNumber>${escapeXmlValue(line.jobNumber)}</JobNumber>\n`;
    xml += `          <LineStatus>${escapeXmlValue(line.lineStatus)}</LineStatus>\n`;
    xml += `          <PostingType>L</PostingType>\n`;
    xml += `          <TechNo>${escapeXmlValue(line.techNo)}</TechNo>\n`;
    xml += `          <HoursWorked>${escapeXmlValue(line.hoursWorked)}</HoursWorked>\n`;
    xml += `          <HoursSold>${escapeXmlValue(line.hoursSold)}</HoursSold>\n`;
    xml += `          <Details>${escapeXmlValue(line.details)}</Details>\n`;
    xml += `        </RowDetails>\n      </ROJobDetails>\n`;
  }
  return xml;
}
