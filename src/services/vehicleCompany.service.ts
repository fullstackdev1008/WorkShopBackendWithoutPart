import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { appointments, vehicles } from '../db/models';

/**
 * Resolve the company (dealership) a vehicle belongs to.
 *
 * This MIRRORS the chain `resolveRoInterfaceCode` uses when it picks the Evolve
 * InterfaceCode for an RO push (jobCardEvolveSync.service.ts):
 *
 *   1. vehicles.owning_company_id  — authoritative; a VIN lives in exactly one
 *                                    company in Evolve (drizzle/0042).
 *   2. appointments.company_id     — legacy fallback for vehicles that predate
 *                                    ownership capture; most recent appointment.
 *   3. null                        — unknown.
 *
 * The two MUST agree. The job-card Franchise / Service-Dept dropdown filters on
 * this value, and the RO is posted with the InterfaceCode derived from the same
 * chain — if they diverged, an advisor could pick a 10EC franchise for an RO
 * that posts to 20EC, which Evolve would reject or misfile.
 *
 * Never throws on "not found": an unknown company is a null, and callers treat
 * that as "don't filter" rather than "show nothing".
 */
export async function resolveVehicleCompanyId(vehicleId: string): Promise<string | null> {
  const [vehicle] = await db
    .select({ owningCompanyId: vehicles.owningCompanyId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .limit(1);

  if (vehicle?.owningCompanyId) return vehicle.owningCompanyId;

  // Fallback: the company recorded on the vehicle's most recent appointment.
  const [appt] = await db
    .select({ companyId: appointments.companyId })
    .from(appointments)
    .where(and(eq(appointments.vehicleId, vehicleId), isNotNull(appointments.companyId)))
    .orderBy(desc(appointments.createdAt))
    .limit(1);

  return appt?.companyId ?? null;
}
