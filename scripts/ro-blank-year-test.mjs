/**
 * LIVE test: does Evolve IRM_ROMaintenance REQUIRE a ModelYear?
 *
 * Replicates the backend's exact RO envelope (buildRoMaintenanceXml) for real
 * vehicle B122503 (VIN AAK2829FLSB122503, ModelCode 18665355, owner 20EC0002915)
 * and posts it to the SAME Evolve endpoint the backend uses (read from .env).
 *
 * Strategy: send with ModelYear BLANK first.
 *   - If Evolve returns success  -> ModelYear is NOT required (relax the guard).
 *   - If Evolve rejects           -> re-send an identical RO with ModelYear=2020.
 *       - filled succeeds         -> ModelYear IS the blocker (guard is correct).
 *       - filled fails the same   -> a DIFFERENT field is the blocker.
 *
 * ⚠️ Creates a REAL RO in the live Evolve environment your backend syncs to.
 *    Guarded behind CONFIRM_LIVE_RO=YES so it can't fire by accident.
 *
 * Run on the server (whitelisted IP), from /var/www/backend:
 *     CONFIRM_LIVE_RO=YES node scripts/ro-blank-year-test.mjs
 *
 * Override the interface code if needed (defaults to this vehicle's company):
 *     CONFIRM_LIVE_RO=YES IFACE=95112-AGLT-20EC node scripts/ro-blank-year-test.mjs
 */
import 'dotenv/config';

if (process.env.CONFIRM_LIVE_RO !== 'YES') {
  console.error('Refusing to run: this creates a REAL RO in live Evolve.');
  console.error('Set CONFIRM_LIVE_RO=YES to proceed.');
  process.exit(1);
}

// ── Evolve config: match the backend exactly (from .env) ─────────────────────
const API_URL        = process.env.EVOLVE_API_URL        || 'https://intu.automate.co.za/wsesIRM/Service.asmx/EvolveRequestAction';
const SOURCE_SYSTEM  = process.env.EVOLVE_SOURCE_SYSTEM  || 'Evolve';
const TARGET_SYSTEM  = process.env.EVOLVE_TARGET_SYSTEM  || 'CRM';
const MESSAGE_CREATOR= process.env.EVOLVE_MESSAGE_CREATOR|| 'CRM';
const TIMEOUT_MS     = parseInt(process.env.EVOLVE_HTTP_TIMEOUT_MS || '120000', 10);
// This vehicle is company 20EC / AGLT (per the customer-vehicle lookup).
const INTERFACE_CODE = process.env.IFACE || '95112-AGLT-20EC';

// ── Vehicle under test (from the IRM_Customer_VehicleLookup for B122503) ──────
const VEH = {
  registrationNo: 'B122503',
  vin: 'AAK2829FLSB122503',
  engineNumber: '1625C010985',
  ownerCustSequenceId: '20EC0002915',
  make: 'FAW',
  modelCode: '18665355',
  modelDescription: 'J5N 28.290FL REFUSE',
  odoIn: '1000',
};

const escapeXml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function ddmmyyyyHHmmss(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function ddmmyyyy(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function buildRoXml(modelYear) {
  const v = escapeXml;
  const trackingId = crypto.randomUUID();
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n<Integration>\n  <Action>\n`;
  xml += `    <Function Type="Request">IRM_ROMaintenance</Function>\n    <Version>1</Version>\n`;
  xml += `    <SourceSystem>${v(SOURCE_SYSTEM)}</SourceSystem>\n`;
  xml += `    <TargetSystem>${v(TARGET_SYSTEM)}</TargetSystem>\n`;
  xml += `    <MessageCreator>${v(MESSAGE_CREATOR)}</MessageCreator>\n`;
  xml += `    <MessageCreationDateTime>${ddmmyyyyHHmmss()}</MessageCreationDateTime>\n`;
  xml += `    <MessageTrackingIdentifier>${trackingId}</MessageTrackingIdentifier>\n`;
  xml += `    <InterfaceCode>${v(INTERFACE_CODE)}</InterfaceCode>\n`;
  xml += `  </Action>\n  <Request>\n    <RowDetails>\n      <RowID>01</RowID>\n      <ROMaintenance>\n`;
  xml += `        <CRMReferenceNo></CRMReferenceNo>\n`;
  xml += `        <RONumber></RONumber>\n`;
  xml += `        <RegistrationNo>${v(VEH.registrationNo)}</RegistrationNo>\n`;
  xml += `        <VehVinNumber>${v(VEH.vin)}</VehVinNumber>\n`;
  xml += `        <EngineNumber>${v(VEH.engineNumber)}</EngineNumber>\n`;
  xml += `        <ModelYear>${v(modelYear)}</ModelYear>\n`;
  xml += `        <OwnerCustSequenceID>${v(VEH.ownerCustSequenceId)}</OwnerCustSequenceID>\n`;
  xml += `        <DriverCustSequenceID>${v(VEH.ownerCustSequenceId)}</DriverCustSequenceID>\n`;
  xml += `        <ContactTodayTelNumber>OC</ContactTodayTelNumber>\n`;
  xml += `        <Make>${v(VEH.make)}</Make>\n        <ModelCode>${v(VEH.modelCode)}</ModelCode>\n`;
  xml += `        <ModelDescription>${v(VEH.modelDescription)}</ModelDescription>\n`;
  xml += `        <OdoIn>${v(VEH.odoIn)}</OdoIn>\n`;
  xml += `        <CustomerWaiting>f</CustomerWaiting>\n        <LoanVehicle>f</LoanVehicle>\n`;
  xml += `        <DropOff>f</DropOff>\n        <PartsClaim>f</PartsClaim>\n        <CSIConsentGiven>no</CSIConsentGiven>\n`;
  xml += `        <AppointmentDate>${v(ddmmyyyy())}</AppointmentDate>\n`;
  xml += `        <FranchiseSeqID>1</FranchiseSeqID>\n`;
  xml += `        <ServiceDept>1</ServiceDept>\n`;
  xml += `        <ServiceAdvisorNumber>1</ServiceAdvisorNumber>\n`;
  xml += `        <ROStatus>WIP</ROStatus>\n        <ROStatusType>W</ROStatusType>\n`;
  xml += `      </ROMaintenance>\n      <ROJobHeader>\n        <RowDetails>\n`;
  xml += `          <JobNumber>01</JobNumber>\n          <JobType>INT</JobType>\n`;
  xml += `          <ServiceType>S06</ServiceType>\n`;
  xml += `          <ValueCPAEstimate>0</ValueCPAEstimate>\n`;
  xml += `          <CustomerStates>ModelYear requirement test</CustomerStates>\n`;
  xml += `          <SAInstruction>ModelYear requirement test</SAInstruction>\n          <JobAction>W</JobAction>\n`;
  xml += `        </RowDetails>\n      </ROJobHeader>\n`;
  xml += `    </RowDetails>\n  </Request>\n</Integration>`;
  return xml;
}

function pick(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

async function send(label, modelYear) {
  const xml = buildRoXml(modelYear);
  console.log(`\n\n########## ${label}  (ModelYear="${modelYear}") ##########`);
  console.log(xml);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let body = '';
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: xml,
      signal: ctrl.signal,
    });
    body = await res.text();
    console.log(`\nHTTP ${res.status}`);
    console.log(body.slice(0, 4000));
  } finally {
    clearTimeout(timer);
  }
  const status = pick(body, 'RequestStatus');
  const rowStatus = pick(body, 'RowStatus');
  const msg = pick(body, 'RowDetailedMessage') || pick(body, 'RequestStatusMessage');
  const roNumber = pick(body, 'DMSReferenceNo');
  const ok = status === 'S' && (rowStatus === 'S' || rowStatus === 'W');
  return { label, modelYear, ok, status, rowStatus, roNumber, msg };
}

async function main() {
  console.log(`Endpoint: ${API_URL}`);
  console.log(`Interface: ${INTERFACE_CODE}  (Target=${TARGET_SYSTEM}, Creator=${MESSAGE_CREATOR})`);

  const results = [];
  const a = await send('A — BLANK year', '');
  results.push(a);

  if (!a.ok) {
    const b = await send('B — FILLED year', '2020');
    results.push(b);
  }

  console.log('\n\n================= SUMMARY =================');
  for (const r of results) {
    console.log(`${r.label}: ok=${r.ok} RequestStatus=${r.status} RowStatus=${r.rowStatus} RO=${r.roNumber || '-'}`);
    if (r.msg) console.log(`   message: ${r.msg}`);
  }
  console.log('------------------------------------------');
  if (a.ok) {
    console.log('VERDICT: blank ModelYear ACCEPTED -> ModelYear is NOT required. Relax the guard.');
  } else {
    const b = results[1];
    if (b?.ok) console.log('VERDICT: blank REJECTED, filled ACCEPTED -> ModelYear IS required. Keep the guard.');
    else console.log('VERDICT: both rejected -> a DIFFERENT field is the blocker (see messages above).');
  }
  console.log('==========================================');
}

main().catch((e) => { console.error('\n❌ Failed:', e.message); process.exit(1); });
