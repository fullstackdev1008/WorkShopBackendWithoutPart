import { eq, and, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { customers, customerContacts, customerCompanyLinks, customerAddresses, customerProfiles, customerAr } from '../db/models';
import { env } from '../config/env';
import { customerMaintenance, splitEvolvePhone } from './evolveIrm.service';
import { companyResolver } from './companyResolver.service';
// Shared identity authority (D2). isPlaceholderSeq is the ONE canonical copy;
// resolveCustomerEvolveId is the ONLY per-company outbound identity resolver.
import { isPlaceholderSeq, resolveCustomerEvolveId } from './customerIdentity.service';

// Resolve the Evolve InterfaceCode for a customer push (Phase C), gated by
// EVOLVE_COMPANY_AWARE_PUSH. If a companyId is supplied (appointment flow),
// resolve it directly. Otherwise derive from customer_company_links:
//   0 links → env default (log NO_COMPANY_LINK)
//   1 link  → resolve that company (no log)
//   >1 links→ env default (log AMBIGUOUS_COMPANY — never guess)
// Returns { interfaceCode, companyId } where both are set together only when a
// company resolved to an ACTIVE interface code; otherwise {} → the XML builder
// uses env.EVOLVE_INTERFACE_CODE and no company is available for C5 enrichment.
// Never fails the sync. All resolution goes through CompanyResolver — no direct
// companies query.
async function resolveCustomerInterfaceCode(
  customerId: string,
  companyId?: string,
): Promise<{ interfaceCode?: string; companyId?: string }> {
  if (!env.EVOLVE_COMPANY_AWARE_PUSH) return {}; // flag off → today's behaviour exactly

  if (companyId) {
    const code = await companyResolver.resolveInterfaceCode(companyId);
    return code ? { interfaceCode: code, companyId } : {};
  }

  const links = await db
    .select({ companyId: customerCompanyLinks.companyId })
    .from(customerCompanyLinks)
    .where(eq(customerCompanyLinks.customerId, customerId));

  if (links.length === 0) {
    console.warn(`[EvolveSync] customer ${customerId} interface code (reason=NO_COMPANY_LINK) → using env default`);
    return {};
  }
  if (links.length > 1) {
    console.warn(`[EvolveSync] customer ${customerId} interface code (reason=AMBIGUOUS_COMPANY, linkCount=${links.length}) → using env default`);
    return {};
  }
  const code = await companyResolver.resolveInterfaceCode(links[0].companyId);
  return code ? { interfaceCode: code, companyId: links[0].companyId } : {};
}

/**
 * Phase 3 — Asynchronous push of a locally-created customer to Evolve.
 *
 * Fire-and-forget: callers invoke this WITHOUT awaiting, AFTER their local
 * transaction has committed, so the user request is never blocked and an
 * Evolve outage cannot fail customer creation. Never throws.
 *
 * DORMANT by default — returns immediately unless EVOLVE_CUSTOMER_SYNC_ENABLED
 * is true. The in-place write-back of the returned CRMReferenceNo /
 * DMSReferenceNo is added in Phase 4; duplicate protection is hardened in
 * Phase 5; a retry/reconciliation sweep is added in Phase 6.
 */
export async function syncCustomerToEvolve(customerId: string, companyId?: string): Promise<void> {
  try {
    // Full freeze — nothing may be pushed to Evolve. Checked before any row is
    // loaded or written, so the customer is left completely untouched and the
    // reconcile sweep has nothing to re-drive. Backstopped in evolveIrm.
    if (env.EVOLVE_SYNC_FREEZE) {
      console.log(
        `[CustomerEvolveSync] EVOLVE_SYNC_FREEZE is on — push for customer ${customerId} skipped; nothing sent to Evolve`,
      );
      return;
    }
    if (!env.EVOLVE_CUSTOMER_SYNC_ENABLED) return; // feature flag — off by default

    const [cust] = await db
      .select({
        id: customers.id,
        crmReferenceNo: customers.crmReferenceNo,
        custSequenceId: customers.custSequenceId,
        customerType: customers.customerType,
        title: customers.title,
        initial: customers.initial,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        primaryEmail: customers.primaryEmail,
        language: customers.language,
        gender: customers.gender,
        maritalStatus: customers.maritalStatus,
        // Type-specific identifiers the CustomerMaintenance contract carries:
        // <IDNumber> for a person, <RegNo> for a company (04a).
        idNumber: customers.idNumber,
        regNo: customers.regNo,
        // AR fields that live on `customers`, not customer_ar — the READ
        // contract returns both inside <CustomerDetail>, which is why they are
        // stored here, but the WRITE contract expects them inside
        // <AccountsReceivable>. Remapped at the XML boundary below.
        currencyCode: customers.currencyCode,
        defaultTaxCode: customers.defaultTaxCode,
      })
      .from(customers)
      .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
      .limit(1);

    if (!cust) return;

    // "Already synced" guard.
    //  • Flag OFF → today's behaviour exactly: a real GLOBAL id means synced.
    //  • Flag ON + companyId → per-company (ADR-002): synced iff the
    //    (customer, company) link already holds a REAL id. Push even when the
    //    global id is real but this company's link is empty.
    //  • Flag ON without a companyId (reconcile / non-company callers) → fall
    //    back to the global guard (no company to scope).
    if (env.EVOLVE_COMPANY_AWARE_PUSH && companyId) {
      const resolved = await resolveCustomerEvolveId(customerId, companyId);
      if (resolved.source === 'link') return; // already synced for THIS company
    } else {
      if (!isPlaceholderSeq(cust.custSequenceId)) return;
    }

    // Best-effort phone (Evolve expects code + number separately).
    const [contact] = await db
      .select({ countryCode: customerContacts.countryCode, contactNumber: customerContacts.contactNumber })
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId))
      .limit(1);

    // Split once — it was previously called twice for the two elements.
    const phone = splitEvolvePhone(contact?.contactNumber);

    // Company vs person discriminator. The booking flow creates company-style
    // customers (name in companyName, no first/last). Evolve only PERSISTS
    // CompanyName when CustomerPersonal='C' (confirmed via UAT probe →
    // 70EC0000087); without it a company record silently loses its name. A
    // person needs CustomerType/CustomerPersonal='P' with first/last. The
    // common fields are shared across both.
    const company = (cust.companyName ?? '').trim();
    const first   = (cust.firstName ?? '').trim();
    const last    = (cust.lastName ?? '').trim();
    const isCompany = company !== '' && first === '' && last === '';

    const customerDetail: Record<string, string> = {
      // Send our local ref as the CRM key (idempotency correlation); Evolve
      // returns the authoritative CRMReferenceNo + DMSReferenceNo.
      CRMReferenceNo: cust.crmReferenceNo || '',
      CustSequenceID: '', // blank → Evolve creates and assigns the id
      Language: cust.language || 'E',
      ActiveCustomer: 'yes',
      PrimaryEmail: cust.primaryEmail ?? '',
      // Canonical Evolve phone regardless of how the local row stored it
      // (legacy "+27" code / trunk-0 number / area-code split): always send
      // CellphoneCode "27" + national number, so it matches phone search.
      //
      // <CellphoneCode> is mandatory (04a: *x(3) M), and splitEvolvePhone
      // returns an EMPTY code when there is no contact row at all — which sent
      // the mandatory element blank. The country code is a constant, not
      // customer data, so falling back to it invents nothing: an unknown NUMBER
      // stays unknown, while the code element is always populated.
      CellphoneCode: phone.code || env.EVOLVE_PHONE_COUNTRY_CODE || '27',
      CellphoneNumber: phone.number,
      ...(isCompany
        ? { CustomerType: 'C', CustomerPersonal: 'C', CompanyName: company, TradingAs: company }
        // <Initial> sits alongside <Title> as the contract's other mandatory
        // person field (04a: *x(8) M) and was previously never sent at all.
        : { CustomerType: 'P', CustomerPersonal: 'P', Title: cust.title ?? '', Initial: cust.initial ?? '', FirstName: first, LastName: last }),
    };

    // ── Enrichment (Gap 5): add address/gender/profile from EXISTING local data.
    // Every field is added ONLY when a local value exists, so a customer without
    // this data yields a byte-identical payload to before. No lookups, no
    // invented IDs, no value guessing — provinceId/areaCode are stored directly
    // on the address row, and gender/maritalStatus were persisted from Evolve.
    const valOf = (v: unknown): string | undefined => {
      const t = (v ?? '').toString().trim();
      return t || undefined;
    };
    const logical = (v: boolean | null | undefined): string | undefined =>
      v === null || v === undefined ? undefined : (v ? 'yes' : 'no');

    const addrRows = await db
      .select({
        addressType: customerAddresses.addressType,
        addressLine1: customerAddresses.addressLine1,
        addressLine2: customerAddresses.addressLine2,
        city: customerAddresses.city,
        provinceId: customerAddresses.provinceId,
        areaCode: customerAddresses.areaCode,
        country: customerAddresses.country,
      })
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customerId));

    const applyAddress = (prefix: 'Physical' | 'Postal', a: (typeof addrRows)[number] | undefined) => {
      if (!a) return;
      const l1 = valOf(a.addressLine1); if (l1) customerDetail[`${prefix}Address1`] = l1;
      const l2 = valOf(a.addressLine2); if (l2) customerDetail[`${prefix}Address2`] = l2;
      const city = valOf(a.city); if (city) customerDetail[`${prefix}City`] = city;
      if (a.provinceId !== null && a.provinceId !== undefined) customerDetail[`${prefix}ProvinceID`] = String(a.provinceId);
      const area = valOf(a.areaCode); if (area) customerDetail[`${prefix}AreaCode`] = area;
      const country = valOf(a.country); if (country) customerDetail[`${prefix}Country`] = country;
    };
    applyAddress('Physical', addrRows.find((a) => (a.addressType ?? '').toUpperCase() === 'PHYSICAL'));
    applyAddress('Postal',   addrRows.find((a) => (a.addressType ?? '').toUpperCase() === 'POSTAL'));

    // Gender / MaritalStatus — persisted verbatim from Evolve; passthrough only.
    const genderVal = valOf(cust.gender); if (genderVal) customerDetail.Gender = genderVal;
    if (cust.maritalStatus !== null && cust.maritalStatus !== undefined) customerDetail.MaritalStatus = String(cust.maritalStatus);

    // Type-specific identifier. 04a_CustomerMaintenance_Request.xml documents
    // <IDNumber> Character x(16) O on the person side and <RegNo> Character
    // x(20) on the company side, so each is sent only for the branch it belongs
    // to — and only when we hold a value, keeping the payload byte-identical
    // for a customer that has none. Never truncated: a silently shortened ID or
    // registration number is worse than Evolve rejecting an over-long one, and
    // both forms already cap their inputs at the contract length.
    if (isCompany) {
      const regNoVal = valOf(cust.regNo); if (regNoVal) customerDetail.RegNo = regNoVal;
    } else {
      const idNumberVal = valOf(cust.idNumber); if (idNumberVal) customerDetail.IDNumber = idNumberVal;
    }

    // CustomerProfile — only the fields IRM_CustomerMaintenance's CustomerProfile
    // block documents (04a). Local csi_consent_* columns are intentionally NOT
    // sent (not part of the write contract). Booleans → Logical {yes/no}.
    const [profile] = await db
      .select({
        occupation: customerProfiles.occupation,
        receiveEmail: customerProfiles.receiveEmail,
        receiveSms: customerProfiles.receiveSms,
        receivePost: customerProfiles.receivePost,
        receiveTelemarketing: customerProfiles.receiveTelemarketing,
        primaryContact: customerProfiles.primaryContact,
        secondaryContact: customerProfiles.secondaryContact,
        receiveMarketingAll: customerProfiles.receiveMarketingAll,
        receiveMarketingVehicle: customerProfiles.receiveMarketingVehicle,
        receiveMarketingService: customerProfiles.receiveMarketingService,
        receiveMarketingParts: customerProfiles.receiveMarketingParts,
      })
      .from(customerProfiles)
      .where(and(eq(customerProfiles.customerId, customerId), isNull(customerProfiles.deletedAt)))
      .limit(1);

    let customerProfile: Record<string, string> | undefined;
    if (profile) {
      const p: Record<string, string> = {};
      const occ = valOf(profile.occupation); if (occ) p.Occupation = occ;
      const pc = valOf(profile.primaryContact); if (pc) p.PrimaryContact = pc;
      const sc = valOf(profile.secondaryContact); if (sc) p.SecondaryContact = sc;
      const setLogical = (key: string, v: boolean | null | undefined) => {
        const r = logical(v); if (r !== undefined) p[key] = r;
      };
      setLogical('ReceiveEmail', profile.receiveEmail);
      setLogical('ReceiveSMS', profile.receiveSms);
      setLogical('ReceivePost', profile.receivePost);
      setLogical('ReceiveTelemarketing', profile.receiveTelemarketing);
      setLogical('ReceiveMarketingAll', profile.receiveMarketingAll);
      setLogical('ReceiveMarketingVehicle', profile.receiveMarketingVehicle);
      setLogical('ReceiveMarketingService', profile.receiveMarketingService);
      setLogical('ReceiveMarketingParts', profile.receiveMarketingParts);
      if (Object.keys(p).length > 0) customerProfile = p;
    }

    // ── AccountsReceivable (04a) ────────────────────────────────────────────
    // Evolve creates no AR master of its own when a customer is created, so a
    // customer synced without this block ends up with no artArMaster record and
    // Evolve then refuses to load a labour line under Cost Jobs (observed live
    // on RO FO008450). This block is what creates it.
    //
    // FIELD NAMES ARE THE WRITE CONTRACT'S, NOT THE READ CONTRACT'S — they
    // differ, and mixing them up silently drops values:
    //   AccountType      ← ar_account_type       (read: ArAccountType)
    //   CreditLimit      ← credit_limit_amount   (read: CreditLimitAmount)
    //   AccountNumber    ← ar_account_number     (read: ArAccountNumber)
    //   InActiveAccount  ← inactive_account      (read: InactiveAccount)
    //   StopCredit       ← stop_credit
    //   TermsCode        ← terms_code            (GetARAccounts: Terms)
    //   CurrencyCode     ← customers.currency_code
    //   DefaultTaxCode   ← customers.default_tax_code
    //
    // Every field is added ONLY when a local value exists, matching the Gap-5
    // enrichment convention above: a customer with no AR data yields a payload
    // byte-identical to before this block existed. No dealer defaults are
    // invented here — AccountType / TermsCode / DefaultTaxCode are dealer
    // configuration and must come from the record, never from code.
    const [arRow] = await db
      .select({
        arAccountNumber: customerAr.arAccountNumber,
        arAccountType: customerAr.arAccountType,
        termsCode: customerAr.termsCode,
        stopCredit: customerAr.stopCredit,
        inactiveAccount: customerAr.inactiveAccount,
        creditLimitAmount: customerAr.creditLimitAmount,
      })
      .from(customerAr)
      .where(and(eq(customerAr.customerId, customerId), isNull(customerAr.deletedAt)))
      .limit(1);

    let accountsReceivable: Record<string, string> | undefined;
    {
      const ar: Record<string, string> = {};
      const accountType = valOf(arRow?.arAccountType); if (accountType) ar.AccountType = accountType;
      const accountNo   = valOf(arRow?.arAccountNumber); if (accountNo) ar.AccountNumber = accountNo;
      const termsCode   = valOf(arRow?.termsCode); if (termsCode) ar.TermsCode = termsCode;
      // numeric(14,2) arrives as a string; sent as held so 0 is preserved
      // (0 is a meaningful credit limit, not an absent one).
      const creditLimit = valOf(arRow?.creditLimitAmount); if (creditLimit) ar.CreditLimit = creditLimit;
      // Logicals: the contract documents these as {yes/no} and Evolve returns
      // 'no' on read, so the sample's `false` is illustrative. Reuses the same
      // logical() helper the CustomerProfile block above uses.
      const stopCredit = logical(arRow?.stopCredit); if (stopCredit !== undefined) ar.StopCredit = stopCredit;
      const inactive   = logical(arRow?.inactiveAccount); if (inactive !== undefined) ar.InActiveAccount = inactive;
      // From `customers` — see the select above for why.
      const currency = valOf(cust.currencyCode); if (currency) ar.CurrencyCode = currency;
      // default_tax_code is integer(1) locally. Sent UNPADDED because Evolve's
      // own reads emit '1' (live IRM_CustomerLookup, 2026-09-09) and
      // IRM_GetARAccounts returns PartsTaxCode/ServiceTaxCode as '1' — the
      // contract sample's '01' is a width hint, not a required format. If UAT
      // shows Evolve wants '01', pad HERE, not in the column.
      if (cust.defaultTaxCode !== null && cust.defaultTaxCode !== undefined) {
        ar.DefaultTaxCode = String(cust.defaultTaxCode);
      }
      if (Object.keys(ar).length > 0) accountsReceivable = ar;
    }

    // Company-aware InterfaceCode (Phase C). interfaceCode undefined →
    // customerMaintenance falls back to env.EVOLVE_INTERFACE_CODE (C2).
    // resolvedCompanyId (set only alongside interfaceCode) targets C5 enrichment.
    const { interfaceCode, companyId: resolvedCompanyId } = await resolveCustomerInterfaceCode(customerId, companyId);
    const result = await customerMaintenance({ customerDetail, customerProfile, accountsReceivable, interfaceCode });

    if (result.success) {
      const newSeq = result.custSequenceId?.trim();
      const newCrm = result.crmReferenceNo?.trim();

      if (!newSeq) {
        // Evolve confirmed success but returned no DMSReferenceNo — do NOT
        // overwrite the placeholder (would lose the local key). Leave it
        // placeholder so the Phase 6 retry can re-attempt.
        console.warn(`[EvolveSync] customer ${customerId} Evolve OK but no DMSReferenceNo returned — leaving placeholder`);
        return;
      }

      // Global write-back is ONLY for the first/primary sync — i.e. while the
      // global cust_sequence_id is still a PLACEHOLDER. During a secondary-company
      // sync the global id is already real and MUST NOT be overwritten (ADR-002);
      // the company-specific identity is recorded on the link (enrichment below).
      if (isPlaceholderSeq(cust.custSequenceId)) {
        // Duplicate guard: if ANOTHER (non-deleted) local customer already holds
        // this Evolve id, do NOT write the global column (would hit
        // uq_customers_crm_and_sequence or point two rows at one Evolve customer).
        // The link is still enriched below, so the company-scoped identity is kept.
        const [clash] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.custSequenceId, newSeq), ne(customers.id, customerId), isNull(customers.deletedAt)))
          .limit(1);
        if (clash) {
          console.warn(
            `[EvolveSync] DUPLICATE detected — Evolve cust_sequence_id=${newSeq} already on local customer ${clash.id}; ` +
            `NOT writing global cust_sequence_id for customer ${customerId}. Manual reconciliation may be required.`,
          );
        } else {
          // In-place update of the SAME local row (by id) — never an insert.
          await db
            .update(customers)
            .set({
              custSequenceId: newSeq,
              ...(newCrm ? { crmReferenceNo: newCrm } : {}),
              updatedAt: new Date(),
            })
            .where(eq(customers.id, customerId));
          console.log(`[EvolveSync] customer ${customerId} synced in-place — cust_sequence_id=${newSeq} crm_reference_no=${newCrm ?? '(unchanged)'}`);
        }
      } else {
        console.log(`[EvolveSync] customer ${customerId} secondary-company sync — global cust_sequence_id preserved; enriching company link only`);
      }

      // C5 — enrich the (customer, company) link with the per-company Evolve
      // identifiers (ADR Appendix C metadata enrichment). UPDATE-only, exactly
      // one row, never insert/reassign. Best-effort: a failure only warns and
      // never affects the authoritative Evolve push result.
      if (resolvedCompanyId && (newSeq || newCrm)) {
        try {
          const updated = await db
            .update(customerCompanyLinks)
            .set({
              ...(newSeq ? { custSequenceId: newSeq } : {}),
              ...(newCrm ? { crmReferenceNo: newCrm } : {}),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(customerCompanyLinks.customerId, customerId),
                eq(customerCompanyLinks.companyId, resolvedCompanyId),
              ),
            )
            .returning({ id: customerCompanyLinks.id });
          if (updated.length === 0) {
            console.warn(`[EvolveSync] customer ${customerId} link enrichment skipped (reason=LINK_NOT_FOUND, companyId=${resolvedCompanyId})`);
          }
        } catch (enrichErr) {
          console.warn(`[EvolveSync] customer ${customerId} link enrichment failed (reason=LINK_ENRICH_FAILED, companyId=${resolvedCompanyId}): ${(enrichErr as Error)?.message}`);
        }
      }
    } else {
      // Failure → leave the placeholder cust_sequence_id intact so the Phase 6
      // retry/reconciliation sweep can re-attempt. Never blocks the caller.
      console.warn(
        `[EvolveSync] customer ${customerId} → Evolve NOT successful (status=${result.requestStatus}/${result.rowStatus}): ${result.message}`,
      );
    }
  } catch (err) {
    // Local-first: never let an Evolve failure surface to the caller.
    console.error(`[EvolveSync] customer ${customerId} sync failed:`, (err as Error)?.message);
  }
}

/**
 * Phase 6 / D2-5 — Retry / reconciliation sweep (candidate discovery only).
 *
 * Discovers customers needing an outbound push and calls syncCustomerToEvolve —
 * which stays the SOLE authority for whether/where to push (it re-guards
 * internally). Reconcile only supplies the (customer, company) context.
 *
 * Flag OFF → today's behaviour EXACTLY: candidates are customers whose GLOBAL
 * cust_sequence_id is still a placeholder; called as syncCustomerToEvolve(id).
 *
 * Flag ON → additionally discovers SECONDARY-company gaps (ADR-002): a customer
 * whose global id is real but who has a company link with cust_sequence_id NULL.
 * Such a customer would be skipped by the D2-2 global guard if called without a
 * company, so we pass the target companyId. Option 1: at most ONE missing-link
 * company per customer per run — each run fills one, the next surfaces on the
 * following run (natural convergence, one unit of work per customer).
 *
 * Coarse pre-filter only — syncCustomerToEvolve re-applies the authoritative
 * guards. Processed sequentially. Dormant unless EVOLVE_CUSTOMER_SYNC_ENABLED.
 */
export async function reconcileUnsyncedCustomers(limit = 50): Promise<{ scanned: number }> {
  // Full freeze — the sweep does nothing. No log here: it runs every 15 minutes.
  if (env.EVOLVE_SYNC_FREEZE) return { scanned: 0 };
  if (!env.EVOLVE_CUSTOMER_SYNC_ENABLED) return { scanned: 0 };

  let rows: Array<{ id: string; companyId: string | null }>;

  if (env.EVOLVE_COMPANY_AWARE_PUSH) {
    // Expanded discovery. One row per customer:
    //  • primary placeholder → companyId NULL (today's set, unchanged)
    //  • else with a NULL-id link → one such companyId (secondary gap)
    // The two branches are mutually exclusive (the secondary branch excludes
    // placeholder-primary rows), so a customer appears at most once → no
    // duplicate (customer, company) work items.
    const result = (await db.execute(sql`
      SELECT id, company_id FROM (
        SELECT c.id AS id, NULL::uuid AS company_id
        FROM customers c
        WHERE c.deleted_at IS NULL
          AND (
            c.cust_sequence_id = ''
            OR starts_with(c.cust_sequence_id, 'LOCAL_')
            OR c.cust_sequence_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
        UNION
        SELECT c.id AS id,
               (
                 SELECT l.company_id
                 FROM customer_company_links l
                 WHERE l.customer_id = c.id AND l.cust_sequence_id IS NULL
                 ORDER BY l.company_id
                 LIMIT 1
               ) AS company_id
        FROM customers c
        WHERE c.deleted_at IS NULL
          AND NOT (
            c.cust_sequence_id = ''
            OR starts_with(c.cust_sequence_id, 'LOCAL_')
            OR c.cust_sequence_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
          AND EXISTS (
            SELECT 1 FROM customer_company_links l
            WHERE l.customer_id = c.id AND l.cust_sequence_id IS NULL
          )
      ) t
      LIMIT ${limit}
    `)) as unknown as { rows?: Array<{ id: string; company_id: string | null }> };
    rows = (result.rows ?? []).map((r) => ({ id: r.id, companyId: r.company_id }));
  } else {
    // Flag OFF — byte-identical to today: global-placeholder candidates only.
    const legacy = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          isNull(customers.deletedAt),
          sql`(
            ${customers.custSequenceId} = ''
            OR starts_with(${customers.custSequenceId}, 'LOCAL_')
            OR ${customers.custSequenceId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )`,
        ),
      )
      .limit(limit);
    rows = legacy.map((r) => ({ id: r.id, companyId: null }));
  }

  for (const r of rows) {
    // syncCustomerToEvolve remains the sole authority; reconcile only provides
    // the target company. companyId NULL → syncCustomerToEvolve(id) as today.
    await syncCustomerToEvolve(r.id, r.companyId ?? undefined);
  }

  if (rows.length) console.log(`[EvolveSync] reconciliation swept ${rows.length} unsynced customer(s)`);
  return { scanned: rows.length };
}
