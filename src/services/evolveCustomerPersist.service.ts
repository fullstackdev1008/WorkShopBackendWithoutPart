import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  customers,
  customerAddresses,
  customerContacts,
  customerProfiles,
  customerAr,
  vehicles,
} from '../db/models';
import type { CustomerVehicleLookupResult } from './evolveIrm.service';

// ─── Coercion Helpers ────────────────────────────────────────────────────────
// Evolve sends everything as strings inside <tag>…</tag>. Convert to the right
// JS / PG types and treat empty strings as null so we don't pollute the DB with
// blank values.

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const num = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};

// "yes"/"no"/"y"/"n"/"true"/"false"/"1"/"0" → boolean | null
const bool = (v: unknown): boolean | null => {
  const s = str(v);
  if (s === null) return null;
  const lower = s.toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(lower)) return true;
  if (['no', 'n', 'false', '0'].includes(lower)) return false;
  return null;
};

// "YYYY-MM-DD" or "DD/MM/YYYY" → ISO date string | null
const dateStr = (v: unknown): string | null => {
  const s = str(v);
  if (s === null) return null;
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // dd/MM/yyyy
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};

// numeric (decimal) — return as string for pg numeric column compatibility
const numStr = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : n.toFixed(2);
};

// Numeric integer parsed from a string-like field; useful for short codes that
// happen to be numeric (e.g. province ID, default tax code).
const intOrNull = (v: unknown): number | null => {
  const n = int(v);
  return n;
};

// ─── Vehicle field mapping ───────────────────────────────────────────────────
// Map an Evolve <Vehicles>/<RowDetails> node to our vehicle catalog columns.
// The Evolve hierarchy is Make → Series → Model Code, so:
//   model             ← Series           (e.g. "DAILY")  — the model/series name
//   seriesDescription ← Series           (kept verbatim for reference)
//   modelDescription  ← ModelDescription (the variant text, e.g. "50C15HE5A8 …")
//   modelCode         ← ModelCode        (Evolve's numeric code, e.g. "28515455")
// NOTE: `model` intentionally uses Series (NOT ModelDescription) so it matches a
// series in the Make→Series picker; the descriptive variant lives in the Model
// Code field. Falls back to ModelDescription only if Series is absent.
export function mapEvolveVehicleFields(veh: Record<string, unknown>) {
  return {
    brand:             str(veh.Make) ?? 'UNKNOWN',
    model:             str(veh.Series) ?? str(veh.ModelDescription) ?? 'UNKNOWN',
    manufacturingYear: int(veh.RegistrationYear),
    engineNumber:      str(veh.EngineNumber),
    extColour:         str(veh.Colour),
    seriesDescription: str(veh.Series),
    modelDescription:  str(veh.ModelDescription),
    modelCode:         str(veh.ModelCode),
    registrationDate:  dateStr(veh.RegistrationDate),
    registrationYear:  int(veh.RegistrationYear),
    evolveSellingDate: dateStr(veh.SellingDate),
    sellingDealerCode: str(veh.SellingDealer),
  };
}

// ─── Contact helpers ─────────────────────────────────────────────────────────

type ContactRow = {
  contactType: string;
  countryCode: string | null;
  contactNumber: string | null;
};

function buildContacts(cd: Record<string, string>): ContactRow[] {
  const rows: ContactRow[] = [];
  const pairs: Array<[string, string, string]> = [
    ['MOBILE',        'CellphoneCode',     'CellphoneNumber'],
    ['WORK',          'WorkTelCode',       'WorkTelNumber'],
    ['HOME',          'HomeTelCode',       'HomeTelNumber'],
    ['HOME_FAX',      'HomeFaxCode',       'HomeFaxNumber'],
  ];
  for (const [type, codeKey, numberKey] of pairs) {
    const number = str(cd[numberKey]);
    if (!number) continue;
    rows.push({
      contactType: type,
      countryCode: str(cd[codeKey]),
      contactNumber: number,
    });
  }
  const intl = str(cd.InternationalTelNo);
  if (intl) {
    rows.push({ contactType: 'INTERNATIONAL', countryCode: null, contactNumber: intl });
  }
  return rows;
}

// ─── Address helpers ─────────────────────────────────────────────────────────

type AddressRow = {
  addressType: string;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  city: string | null;
  provinceId: number | null;
  areaCode: string | null;
  country: string | null;
};

function buildAddresses(cd: Record<string, string>): AddressRow[] {
  const rows: AddressRow[] = [];
  const specs: Array<[string, string]> = [
    ['PHYSICAL',  'Physical'],
    ['POSTAL',    'Postal'],
    ['DELIVERY',  'Delivery'],
  ];
  for (const [type, prefix] of specs) {
    const line1 = str(cd[`${prefix}Address1`]);
    const line2 = str(cd[`${prefix}Address2`]);
    const line3 = str(cd[`${prefix}Address3`]);
    const city = str(cd[`${prefix}City`]);
    // Skip if no address content at all — Evolve sometimes sends a placeholder
    // empty block for address types the customer hasn't filled in.
    if (!line1 && !line2 && !line3 && !city) continue;
    rows.push({
      addressType: type,
      addressLine1: line1,
      addressLine2: line2,
      addressLine3: line3,
      city,
      provinceId: intOrNull(cd[`${prefix}ProvinceID`]),
      areaCode: str(cd[`${prefix}AreaCode`]),
      country: str(cd[`${prefix}Country`]),
    });
  }
  return rows;
}

// ─── Main Persist ────────────────────────────────────────────────────────────

export interface PersistResult {
  customerId: string;
  /** First persisted vehicle ID — backward-compat with single-vehicle callers. */
  vehicleId: string | null;
  /** All persisted vehicle IDs in the order Evolve returned them. */
  vehicleIds: string[];
}

/**
 * Persist a full Evolve customer + vehicle payload into local DB.
 * - Upserts customer by `custSequenceId` (Evolve's PK).
 * - Replaces all dependent rows (addresses, contacts, profile, AR) so the
 *   local copy always mirrors Evolve's current state.
 * - Upserts vehicle by VIN.
 * Wraps everything in a single transaction.
 */
export async function persistEvolveCustomer(
  data: CustomerVehicleLookupResult,
  // When the caller knows which company produced this authoritative Evolve
  // FOUND, pass its id so every persisted vehicle records its owning company.
  // Omitted by non-company-scoped callers → ownership is left untouched.
  opts?: { owningCompanyId?: string | null },
): Promise<PersistResult> {
  const cd = data.CustomerDetail;
  const cp = data.CustomerProfile;
  const ar = data.AccountsReceivable as Record<string, string>;
  // Evolve can return multiple vehicles per customer (fleet customers).
  // Persist every one. Fall back to data.Vehicles for callers that only
  // populated the legacy single-vehicle field.
  const vehList = data.VehiclesAll && data.VehiclesAll.length > 0
    ? data.VehiclesAll
    : (data.Vehicles && Object.keys(data.Vehicles).length > 0 ? [data.Vehicles] : []);

  const custSequenceId = str(cd.CustSequenceID);
  if (!custSequenceId) {
    throw new Error('persistEvolveCustomer: CustSequenceID is required');
  }

  const customerIdResult: string = await db.transaction(async (tx) => {
    // ─── 1. UPSERT customer ──────────────────────────────────────────────
    const customerValues = {
      crmReferenceNo: str(cd.CRMReferenceNo) ?? '',
      custSequenceId,
      customerType: str(cd.CustomerType) ?? (str(cd.CompanyName) ? 'C' : 'I'),

      title: str(cd.Title),
      initial: str(cd.Initial),
      firstName: str(cd.FirstName),
      lastName: str(cd.LastName),

      companyName: str(cd.CompanyName),
      tradingAs: str(cd.TradingAs),

      idNumber: str(cd.IDNumber),
      passportNumber: str(cd.PassportNumber),
      birthDate: dateStr(cd.BirthDate),
      gender: str(cd.Gender),
      maritalStatus: intOrNull(cd.MaritalStatus),
      language: str(cd.Language),

      citizen: bool(cd.Citizen),
      internalCustomer: bool(cd.InternalCustomer),
      locked: bool(cd.Locked),
      activeCustomer: bool(cd.ActiveCustomer) ?? true,
      customerPersonal: str(cd.CustomerPersonal),

      status: intOrNull(cd.Status),
      financeInstitution: str(cd.FinanceInstitution),
      customerSalesType: str(cd.CustomerSalesType),

      primaryEmail: str(cd.PrimaryEmail),
      secondaryEmail: str(cd.SecondaryEmail),
      webAddress: str(cd.WebAddress),

      regNo: str(cd.RegNo),
      taxNo: str(cd.TaxNo),
      ficNo: str(cd.FICNo),
      currencyCode: str(cd.CurrencyCode),

      leadType: str(cd.LeadType) ?? 'EVOLVE',
      leadSource: str(cd.LeadSource) ?? 'IRM_LOOKUP',
      defaultTaxCode: intOrNull(cd.DefaultTaxCode),

      fleetNo: str(cd.FleetNo),
      notes: str(cd.Notes),

      sellingDealer: str(cd.SellingDealer),
      sellingDate: dateStr(cd.SellingDate),

      oemCustomerType: str(cd.OEMCustomerType),
    };

    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.custSequenceId, custSequenceId), isNull(customers.deletedAt)))
      .limit(1);

    let customerId: string;
    if (existing) {
      await tx
        .update(customers)
        .set({ ...customerValues, updatedAt: new Date() })
        .where(eq(customers.id, existing.id));
      customerId = existing.id;
    } else {
      const [created] = await tx
        .insert(customers)
        .values(customerValues)
        .returning({ id: customers.id });
      customerId = created.id;
    }

    // ─── 2. REPLACE addresses ────────────────────────────────────────────
    await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, customerId));
    const addressRows = buildAddresses(cd).map((a) => ({ ...a, customerId }));
    if (addressRows.length > 0) {
      await tx.insert(customerAddresses).values(addressRows);
    }

    // ─── 3. REPLACE contacts ─────────────────────────────────────────────
    await tx.delete(customerContacts).where(eq(customerContacts.customerId, customerId));
    const contactRows = buildContacts(cd).map((c) => ({ ...c, customerId }));
    if (contactRows.length > 0) {
      await tx.insert(customerContacts).values(contactRows);
    }

    // ─── 4. REPLACE profile ──────────────────────────────────────────────
    await tx.delete(customerProfiles).where(eq(customerProfiles.customerId, customerId));
    if (Object.keys(cp).length > 0) {
      await tx.insert(customerProfiles).values({
        customerId,
        occupation: str(cp.Occupation),
        receiveEmail: bool(cp.ReceiveEmail),
        receiveSms: bool(cp.ReceiveSMS),
        receivePost: bool(cp.ReceivePost),
        receiveTelemarketing: bool(cp.ReceiveTelemarketing),
        primaryContact: str(cp.PrimaryContact),
        secondaryContact: str(cp.SecondaryContact),
        receiveMarketingAll: bool(cp.ReceiveMarketingAll),
        receiveMarketingVehicle: bool(cp.ReceiveMarketingVehicle),
        receiveMarketingService: bool(cp.ReceiveMarketingService),
        receiveMarketingParts: bool(cp.ReceiveMarketingParts),
        csiConsentService: bool(cp.CSIConsentService) ?? false,
        csiConsentVehicles: bool(cp.CSIConsentVehicles) ?? false,
        csiConsentSurveys: bool(cp.CSIConsentSurveys) ?? false,
        csiConsentBulkSms: bool(cp.CSIConsentBulkSMS) ?? false,
      });
    }

    // ─── 5. REPLACE AR account ───────────────────────────────────────────
    await tx.delete(customerAr).where(eq(customerAr.customerId, customerId));
    if (Object.keys(ar).length > 0) {
      await tx.insert(customerAr).values({
        customerId,
        dbArSeqId: str(ar.DbArSeqID),
        arAccountNumber: str(ar.ArAccountNumber),
        arAccountType: str(ar.ArAccountType),
        arTypeDescrip: str(ar.ArTypeDescrip),
        inactiveAccount: bool(ar.InactiveAccount) ?? false,
        stopCredit: bool(ar.StopCredit) ?? false,
        creditLimitAmount: numStr(ar.CreditLimitAmount),
        creditAvailableAmount: numStr(ar.CreditAvailableAmount),
      });
    }

    return customerId;
  });

  // ─── 6. UPSERT each vehicle by VIN (OUTSIDE main tx) ───────────────────
  // Fleet customers can have hundreds of vehicles; persisting them all in the
  // main tx means one bad row (e.g. duplicate VIN with another customer)
  // rolls back the entire customer + addresses + AR write. We persist
  // vehicles one-by-one with individual try/catch so 1 bad row doesn't
  // sink the other 238.
  const vehicleIds: string[] = [];
  let failedCount = 0;

  // Company stamp (last-authoritative-wins). Applied to every vehicle on both
  // insert and update when the caller supplied the resolving company.
  const ownershipFields = opts?.owningCompanyId
    ? { owningCompanyId: opts.owningCompanyId, evolveSyncedAt: new Date() }
    : {};

  for (const veh of vehList) {
    const vin = str(veh.VehVinNumber);
    if (!vin) continue;

    try {
      const [existingVeh] = await db
        .select({
          id: vehicles.id,
          owningCompanyId: vehicles.owningCompanyId,
          // Columns compared for change-detection (see the update block below),
          // so a re-sync from an Evolve search only writes when data actually
          // changed — otherwise updated_at was bumped needlessly, resurfacing
          // released vehicles in date-filtered lists.
          customerId: vehicles.customerId,
          // `vin` is written in updateValues, so it is part of the diff below.
          // Without selecting it here, existingRow.vin was always `undefined`
          // and norm(vin) !== norm(undefined) was always true — `changed` was
          // therefore always true and the optimisation never suppressed a
          // write. Selecting it makes the comparison meaningful.
          vin: vehicles.vin,
          brand: vehicles.brand,
          model: vehicles.model,
          manufacturingYear: vehicles.manufacturingYear,
          engineNumber: vehicles.engineNumber,
          extColour: vehicles.extColour,
          seriesDescription: vehicles.seriesDescription,
          modelDescription: vehicles.modelDescription,
          modelCode: vehicles.modelCode,
          registrationDate: vehicles.registrationDate,
          registrationYear: vehicles.registrationYear,
          evolveSellingDate: vehicles.evolveSellingDate,
          sellingDealerCode: vehicles.sellingDealerCode,
          registrationNumber: vehicles.registrationNumber,
        })
        .from(vehicles)
        .where(and(eq(vehicles.vin, vin), isNull(vehicles.deletedAt)))
        .limit(1);

      const vehicleValues = {
        customerId: customerIdResult,
        ...mapEvolveVehicleFields(veh),
        vin,
        registrationNumber: str(veh.RegistrationNo),
        odometerLast: 0,
        ...ownershipFields,
      };

      if (existingVeh) {
        // Transfer detection: a FOUND under a different company reassigns ownership.
        if (
          opts?.owningCompanyId &&
          existingVeh.owningCompanyId &&
          existingVeh.owningCompanyId !== opts.owningCompanyId
        ) {
          console.log(
            `[persistEvolveCustomer] vehicle ${vin} ownership reassigned ${existingVeh.owningCompanyId} → ${opts.owningCompanyId} (Evolve transfer)`,
          );
        }
        // Keep odometerLast as-is on update (don't reset to 0).
        const { odometerLast: _ignored, ...updateValues } = vehicleValues;
        // Evolve's vehicle master frequently returns a BLANK EngineNumber even
        // when we already hold a good one (observed in real captures — see
        // evolveVehicleMap.test.ts). `str()` maps '' / whitespace → null, so a
        // straight overwrite would erase a valid local value. Evolve refuses to
        // load a labour line on an RO whose Engine No is blank, so losing it
        // breaks the RO sync downstream. Fill-blanks-only: a non-empty Evolve
        // value still wins; a blank one leaves what we have untouched.
        if (!updateValues.engineNumber && existingVeh.engineNumber) {
          updateValues.engineNumber = existingVeh.engineNumber;
        }
        // Only write (and bump updated_at) when a mapped field actually
        // changed. evolveSyncedAt is a volatile per-call marker, so it's
        // excluded from the diff — otherwise every re-sync would look "changed".
        const norm = (v: unknown) => (v === null || v === undefined ? null : String(v));
        const existingRow = existingVeh as Record<string, unknown>;
        const { evolveSyncedAt: _syncMarker, ...comparable } = updateValues as Record<string, unknown>;
        const changed = Object.entries(comparable).some(
          ([key, value]) => norm(value) !== norm(existingRow[key]),
        );
        if (changed) {
          await db
            .update(vehicles)
            .set({ ...updateValues, updatedAt: new Date() })
            .where(eq(vehicles.id, existingVeh.id));
        }
        vehicleIds.push(existingVeh.id);
      } else {
        const [createdVeh] = await db
          .insert(vehicles)
          .values(vehicleValues)
          .returning({ id: vehicles.id });
        vehicleIds.push(createdVeh.id);
      }
    } catch (vehErr) {
      const msg = (vehErr as Error).message ?? '';
      // Evolve sometimes returns multiple vehicles sharing the same
      // registration number (data-quality issue on their side). Our unique
      // index rejects the duplicate. Retry without registration_number —
      // the vehicle still gets saved keyed by VIN, just with a blank reg.
      if (msg.includes('uq_vehicles_registration_active')) {
        try {
          const [existingVeh] = await db
            // engineNumber is selected so the same fill-blanks-only guard as the
            // main update path can run here too (a blank Evolve value must not
            // erase a good local one on the duplicate-registration retry).
            .select({ id: vehicles.id, engineNumber: vehicles.engineNumber })
            .from(vehicles)
            .where(and(eq(vehicles.vin, vin), isNull(vehicles.deletedAt)))
            .limit(1);

          const retryValues = {
            customerId: customerIdResult,
            ...mapEvolveVehicleFields(veh),
            vin,
            registrationNumber: null,
            odometerLast: 0,
            ...ownershipFields,
          };

          if (existingVeh) {
            const { odometerLast: _ignored, ...updateValues } = retryValues;
            if (!updateValues.engineNumber && existingVeh.engineNumber) {
              updateValues.engineNumber = existingVeh.engineNumber;
            }
            await db
              .update(vehicles)
              .set({ ...updateValues, updatedAt: new Date() })
              .where(eq(vehicles.id, existingVeh.id));
            vehicleIds.push(existingVeh.id);
          } else {
            const [createdVeh] = await db
              .insert(vehicles)
              .values(retryValues)
              .returning({ id: vehicles.id });
            vehicleIds.push(createdVeh.id);
          }
          console.log(`[persistEvolveCustomer] vehicle ${vin} persisted without registration number (duplicate reg in Evolve)`);
          continue;
        } catch (retryErr) {
          failedCount++;
          console.log(`[persistEvolveCustomer] vehicle ${vin} retry failed:`, (retryErr as Error).message);
          continue;
        }
      }
      failedCount++;
      console.log(`[persistEvolveCustomer] vehicle ${vin} failed:`, msg);
    }
  }

  if (failedCount > 0) {
    console.log(`[persistEvolveCustomer] vehicles persisted: ${vehicleIds.length}, failed: ${failedCount}`);
  }

  return { customerId: customerIdResult, vehicleId: vehicleIds[0] ?? null, vehicleIds };
}
