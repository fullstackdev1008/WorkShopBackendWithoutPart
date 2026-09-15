import { FastifyRequest } from 'fastify';
import { and, count, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  customers,
  customerAddresses,
  customerContacts,
  customerProfiles,
  customerAr,
  vehicles,
} from '../../db/models';
import {
  createCustomerSchema,
  updateCustomerSchema,
  searchCustomerSchema,
  customerIdParamSchema,
} from './dto';
import { syncCustomerToEvolve } from '../../services/customerEvolveSync.service';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { lookupByCustSequenceId, lookupCustomerArAccounts } from '../../services/evolveIrm.service';
import { persistEvolveCustomer } from '../../services/evolveCustomerPersist.service';
import { customerCompanyLinks, companies } from '../../db/models';

// ─── AR Accounts (live Evolve lookup) ────────────────────────────────────────

/**
 * GET /api/customers/:id/ar-accounts — the customer's Evolve AR accounts.
 *
 * Queried LIVE on every call (IRM_CustomerLookup) rather than read from the
 * local customer_ar mirror: an account opened in Evolve after our last lookup
 * would otherwise be invisible, and the job-card screen must never offer a
 * stale or missing account. Read-only — nothing is persisted here.
 *
 * The interface code is resolved from the customer's OWN company link, not from
 * env.EVOLVE_INTERFACE_CODE: the env default points at one branch, so falling
 * back to it for a customer belonging to another would query the wrong company.
 * An explicit ?companyId= wins (the caller's screen knows the company); with no
 * single link we fall back to the env default and say so in the log.
 */
export async function getCustomerArAccounts(request: FastifyRequest) {
  try {
    const { id } = request.params as { id: string };
    const { companyId } = request.query as { companyId?: string };

    const [customer] = await db
      .select({ id: customers.id, custSequenceId: customers.custSequenceId })
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .limit(1);
    if (!customer) return error(HttpStatus.NOT_FOUND, 'Customer not found');

    // No Evolve identity yet → no accounts can exist. Not an error: a locally
    // created customer simply has nothing in Evolve to look up.
    const seq = (customer.custSequenceId ?? '').trim();
    if (!seq) {
      return success('Customer has no Evolve sequence id yet', { accounts: [], custSequenceId: null });
    }

    let interfaceCode: string | undefined;
    if (companyId) {
      const [co] = await db
        .select({ interfaceCode: companies.interfaceCode })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      interfaceCode = co?.interfaceCode;
    }
    if (!interfaceCode) {
      const links = await db
        .select({ interfaceCode: companies.interfaceCode })
        .from(customerCompanyLinks)
        .innerJoin(companies, eq(companies.id, customerCompanyLinks.companyId))
        .where(eq(customerCompanyLinks.customerId, id));
      if (links.length === 1) interfaceCode = links[0].interfaceCode;
      else console.warn(`[Customer] AR lookup ${id}: ${links.length} company link(s) → using env interface code`);
    }

    const accounts = await lookupCustomerArAccounts(seq, interfaceCode);
    return success('AR accounts retrieved', { accounts, custSequenceId: seq });
  } catch (err) {
    return serverError(err);
  }
}

// ─── Search Customers (Dropdown) ─────────────────────────────────────────────
export async function searchCustomers(request: FastifyRequest) {
  try {
    const { q, phone } = request.query as any;

    const baseConditions = [
      eq(customers.isActive, true),
      isNull(customers.deletedAt),
    ] as any[];

    if (phone) {
      const phoneTerm = `%${phone.replace(/\s+/g, '')}%`;
      baseConditions.push(
        sql`EXISTS (
          SELECT 1 FROM customer_contacts cc
          WHERE cc.customer_id = ${customers.id}
            AND cc.deleted_at IS NULL
            AND REPLACE(cc.contact_number, ' ', '') ILIKE ${phoneTerm}
        )`,
      );
    } else if (q) {
      const searchTerm = `%${q}%`;
      baseConditions.push(
        or(
          ilike(customers.firstName, searchTerm),
          ilike(customers.lastName, searchTerm),
          ilike(customers.companyName, searchTerm),
          ilike(customers.crmReferenceNo, searchTerm),
          ilike(customers.primaryEmail, searchTerm),
          sql`EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.customer_id = ${customers.id}
              AND (
                REPLACE(v.registration_number, ' ', '') ILIKE ${`%${q.replace(/\s+/g, '')}%`}
                OR v.vin ILIKE ${searchTerm}
              )
          )`,
        ),
      );
    }

    const result = await db
      .select({
        id: customers.id,
        crmReferenceNo: customers.crmReferenceNo,
        custSequenceId: customers.custSequenceId,
        customerType: customers.customerType,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        primaryEmail: customers.primaryEmail,
        activeCustomer: customers.activeCustomer,
        contactNumber:
          sql<string>`(SELECT contact_number FROM customer_contacts WHERE customer_id = "customers"."id" AND deleted_at IS NULL LIMIT 1)`,
        vehicleRegistration:
          sql<string>`(SELECT registration_number FROM vehicles WHERE customer_id = "customers"."id" ORDER BY created_at DESC LIMIT 1)`,
        vehicleBrand:
          sql<string>`(SELECT brand FROM vehicles WHERE customer_id = "customers"."id" ORDER BY created_at DESC LIMIT 1)`,
        vehicleModel:
          sql<string>`(SELECT model FROM vehicles WHERE customer_id = "customers"."id" ORDER BY created_at DESC LIMIT 1)`,
      })
      .from(customers)
      .where(and(...baseConditions))
      .limit(20);

    return success('Customers fetched successfully', result);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create Customer (Transaction) ───────────────────────────────────────────
export async function createCustomer(request: FastifyRequest) {
  try {
    const body = request.body as any;
    const { addresses, contacts, profile, ar, ...customerData } = body;

    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.crmReferenceNo, customerData.crmReferenceNo),
          eq(customers.custSequenceId, customerData.custSequenceId),
        ),
      )
      .limit(1);

    if (existing) {
      return error(HttpStatus.CONFLICT, 'Customer with this CRM reference and sequence ID already exists');
    }

    const result = await db.transaction(async (tx: any) => {
      const [newCustomer] = await tx
        .insert(customers)
        .values(customerData)
        .returning();

      let insertedAddresses: any[] = [];
      let insertedContacts: any[] = [];
      let insertedProfile = null;

      if (addresses && addresses.length > 0) {
        insertedAddresses = await tx
          .insert(customerAddresses)
          .values(addresses.map((a: any) => ({ ...a, customerId: newCustomer.id })))
          .returning();
      }

      if (contacts && contacts.length > 0) {
        insertedContacts = await tx
          .insert(customerContacts)
          .values(contacts.map((c: any) => ({ ...c, customerId: newCustomer.id })))
          .returning();
      }

      if (profile) {
        const [p] = await tx
          .insert(customerProfiles)
          .values({ ...profile, customerId: newCustomer.id })
          .returning();
        insertedProfile = p;
      }

      let insertedAr = null;
      if (ar) {
        const [a] = await tx
          .insert(customerAr)
          .values({ ...ar, customerId: newCustomer.id })
          .returning();
        insertedAr = a;
      }

      return {
        ...newCustomer,
        addresses: insertedAddresses,
        contacts: insertedContacts,
        profile: insertedProfile,
        ar: insertedAr,
      };
    });

    // Local-first async push to Evolve (fire-and-forget; dormant unless the
    // feature flag is on; never blocks this response). Phase 3.
    void syncCustomerToEvolve(result.id).catch(() => { /* logged inside */ });

    return created('Customer created successfully', result);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Customer (Transaction) ───────────────────────────────────────────
export async function updateCustomer(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.isActive, true),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);

    if (!customer) {
      return error(HttpStatus.NOT_FOUND, 'Customer not found');
    }

    const { addresses, contacts, profile, ...customerData } = body;

    const result = await db.transaction(async (tx: any) => {
      const hasCustomerFields = Object.keys(customerData).length > 0;
      let updatedCustomer;

      if (hasCustomerFields) {
        const [updated] = await tx
          .update(customers)
          .set({ ...customerData, updatedAt: new Date() })
          .where(eq(customers.id, id))
          .returning();
        updatedCustomer = updated;
      } else {
        const [current] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, id))
          .limit(1);
        updatedCustomer = current;
      }

      let updatedAddresses;
      if (addresses !== undefined) {
        await tx
          .delete(customerAddresses)
          .where(eq(customerAddresses.customerId, id));

        updatedAddresses =
          addresses.length > 0
            ? await tx
                .insert(customerAddresses)
                .values(addresses.map((a: any) => ({ ...a, customerId: id })))
                .returning()
            : [];
      } else {
        updatedAddresses = await tx
          .select()
          .from(customerAddresses)
          .where(eq(customerAddresses.customerId, id));
      }

      let updatedContacts;
      if (contacts !== undefined) {
        await tx
          .delete(customerContacts)
          .where(eq(customerContacts.customerId, id));

        updatedContacts =
          contacts.length > 0
            ? await tx
                .insert(customerContacts)
                .values(contacts.map((c: any) => ({ ...c, customerId: id })))
                .returning()
            : [];
      } else {
        updatedContacts = await tx
          .select()
          .from(customerContacts)
          .where(eq(customerContacts.customerId, id));
      }

      let updatedProfile;
      if (profile !== undefined) {
        await tx
          .delete(customerProfiles)
          .where(eq(customerProfiles.customerId, id));

        const [p] = await tx
          .insert(customerProfiles)
          .values({ ...profile, customerId: id })
          .returning();
        updatedProfile = p;
      } else {
        const [existing] = await tx
          .select()
          .from(customerProfiles)
          .where(eq(customerProfiles.customerId, id))
          .limit(1);
        updatedProfile = existing || null;
      }

      return {
        ...updatedCustomer,
        addresses: updatedAddresses,
        contacts: updatedContacts,
        profile: updatedProfile,
      };
    });

    return success('Customer updated successfully', result);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Customer (Soft Delete) ───────────────────────────────────────────
export async function deleteCustomer(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [customer] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.isActive, true),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);

    if (!customer) {
      return error(HttpStatus.NOT_FOUND, 'Customer not found');
    }

    const [{ total }] = await db
      .select({ total: count() })
      .from(vehicles)
      .where(eq(vehicles.customerId, id));

    if (total > 0) {
      return error(HttpStatus.BAD_REQUEST, 'Cannot delete customer with linked vehicles. Please remove associated vehicles first.');
    }

    await db
      .update(customers)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(customers.id, id));

    return success('Customer deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Customer Details ────────────────────────────────────────────────────
export async function getCustomerDetails(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.isActive, true)))
      .limit(1);

    if (!customer) {
      return error(HttpStatus.NOT_FOUND, 'Customer not found');
    }

    const addresses = await db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, id));

    const contacts = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, id));

    const [profile] = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.customerId, id))
      .limit(1);

    return success('Customer details fetched successfully', {
      ...customer,
      addresses,
      contacts,
      profile: profile || null,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Vehicles By Customer ID ─────────────────────────────────────────────
export async function getCustomerVehicles(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.isActive, true)))
      .limit(1);

    if (!customer) {
      return error(HttpStatus.NOT_FOUND, 'Customer not found');
    }

    const customerVehicles = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.customerId, id));

    return success('Customer vehicles fetched successfully', {
      customer: {
        id: customer.id,
        crmReferenceNo: customer.crmReferenceNo,
        customerType: customer.customerType,
        firstName: customer.firstName,
        lastName: customer.lastName,
        companyName: customer.companyName,
        primaryEmail: customer.primaryEmail,
        createdAt: customer.createdAt,
      },
      vehicles: customerVehicles,
      total: customerVehicles.length,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Sync Customer from IRM ──────────────────────────────────────────────────
export async function syncCustomerFromIrm(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [customer] = await db
      .select({
        id: customers.id,
        custSequenceId: customers.custSequenceId,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        primaryEmail: customers.primaryEmail,
        crmReferenceNo: customers.crmReferenceNo,
      })
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .limit(1);

    if (!customer) return error(HttpStatus.NOT_FOUND, 'Customer not found');

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (UUID_REGEX.test(customer.custSequenceId) || customer.custSequenceId.startsWith('LOCAL_')) {
      return success('Customer was created locally — no IRM record available', {
        synced: false,
        local: true,
        irmData: null,
      });
    }

    const irmResult = await lookupByCustSequenceId(customer.custSequenceId);

    if (!irmResult.found) {
      return success('Customer not found in IRM', { synced: false, local: false, irmData: null });
    }

    // Persist the full Evolve payload — customer fields, addresses, contacts,
    // profile, AR, vehicle. Replaces the previous narrow "update first/last/
    // email + upsert mobile" logic.
    try {
      await persistEvolveCustomer(irmResult);
    } catch (persistErr) {
      console.log('syncFromIrm: persistEvolveCustomer failed :- ', persistErr);
    }

    return success('Customer synced from IRM successfully', {
      synced: true,
      local: false,
      irmData: {
        CustomerDetail:     irmResult.CustomerDetail,
        CustomerProfile:    irmResult.CustomerProfile,
        Vehicles:           irmResult.Vehicles,
        AccountsReceivable: irmResult.AccountsReceivable,
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Lookup Customer by CustSequenceID (IRM + Local) ─────────────────────────
export async function lookupCustomerBySequence(request: FastifyRequest) {
  try {
    const { custSequenceId } = request.query as { custSequenceId?: string };

    if (!custSequenceId?.trim()) {
      return error(HttpStatus.BAD_REQUEST, 'custSequenceId query parameter is required');
    }

    let irmData: { CustomerDetail: Record<string, unknown>; CustomerProfile: Record<string, unknown>; Vehicles: Record<string, unknown>; VehiclesAll: Record<string, unknown>[]; AccountsReceivable?: Record<string, unknown> } | null = null;
    try {
      const irmResult = await lookupByCustSequenceId(custSequenceId.trim());
      if (irmResult.found) {
        irmData = {
          CustomerDetail:     irmResult.CustomerDetail,
          CustomerProfile:    irmResult.CustomerProfile,
          Vehicles:           irmResult.Vehicles,
          VehiclesAll:        irmResult.VehiclesAll,
          AccountsReceivable: irmResult.AccountsReceivable,
        };
        // Persist full payload so subsequent local queries see addresses,
        // contacts, profile, AR — not just the basic fields.
        try {
          await persistEvolveCustomer(irmResult);
        } catch (persistErr) {
          console.log('lookupCustomerBySequence: persistEvolveCustomer failed :- ', persistErr);
        }
      }
    } catch (err) {
      console.error('[Customer] IRM lookup failed:', err);
    }

    const [localCustomer] = await db
      .select({
        id:             customers.id,
        crmReferenceNo: customers.crmReferenceNo,
        custSequenceId: customers.custSequenceId,
        customerType:   customers.customerType,
        firstName:      customers.firstName,
        lastName:       customers.lastName,
        companyName:    customers.companyName,
        primaryEmail:   customers.primaryEmail,
        activeCustomer: customers.activeCustomer,
        notes:          customers.notes,
      })
      .from(customers)
      .where(and(eq(customers.custSequenceId, custSequenceId.trim()), isNull(customers.deletedAt)))
      .limit(1);

    let localData: typeof localCustomer & { fullName: string; contacts: { contactType: string; countryCode: string | null; contactNumber: string | null }[]; addresses: unknown[] } | null = null;

    if (localCustomer) {
      const contacts = await db
        .select({ contactType: customerContacts.contactType, countryCode: customerContacts.countryCode, contactNumber: customerContacts.contactNumber })
        .from(customerContacts)
        .where(eq(customerContacts.customerId, localCustomer.id));

      const addresses = await db
        .select()
        .from(customerAddresses)
        .where(eq(customerAddresses.customerId, localCustomer.id));

      localData = {
        ...localCustomer,
        fullName: `${localCustomer.firstName ?? ''} ${localCustomer.lastName ?? ''}`.trim() || localCustomer.companyName || '',
        contacts,
        addresses,
      };
    }

    return success('Customer lookup completed', {
      irmData,
      localData,
      source: irmData ? 'irm' : localData ? 'local' : 'not_found',
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add / Update Internal Notes ─────────────────────────────────────────────
export async function addCustomerNote(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as { notes?: unknown };

    if (typeof body.notes !== 'string') {
      return error(HttpStatus.BAD_REQUEST, 'notes must be a string');
    }
    if (body.notes.length > 2000) {
      return error(HttpStatus.BAD_REQUEST, 'notes must be 2000 characters or fewer');
    }

    const [updated] = await db
      .update(customers)
      .set({ notes: body.notes, updatedAt: new Date() })
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .returning({ id: customers.id, notes: customers.notes });

    if (!updated) {
      return error(HttpStatus.NOT_FOUND, 'Customer not found');
    }

    return success('Notes saved', { id: updated.id, notes: updated.notes });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
