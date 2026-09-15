import { FastifyRequest } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { vehicleCheckIns, vehicles, customers } from '../../db/models';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolveActorId } from '../../shared/utils/resolveActor';
import { setRoStatus } from '../../shared/utils/roStatus';
import { resolveUserScope, shopFilter, checkInInScope } from '../../shared/security/scope';

// Washbay queue — vehicles whose RO status is WASHBAY. FIFO order so the
// person managing the queue knows who's been waiting longest.
export async function listAwaiting(request: FastifyRequest) {
  try {
    const scope = await resolveUserScope(request);
    const rows = await db
      .select({
        checkInId: vehicleCheckIns.id,
        roStatusAt: vehicleCheckIns.roStatusAt,
        vehicleId: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        receivingNo: vehicleCheckIns.receivingNo,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(vehicleCheckIns)
      .innerJoin(vehicles, eq(vehicles.id, vehicleCheckIns.vehicleId))
      .leftJoin(customers, eq(customers.id, vehicles.customerId))
      .where(and(eq(vehicleCheckIns.isActive, true), eq(vehicleCheckIns.roStatus, 'WASHBAY'), shopFilter(scope)))
      .orderBy(asc(vehicleCheckIns.roStatusAt));

    const items = rows.map((r) => ({
      ...r,
      customerName: `${r.customerFirstName ?? ''} ${r.customerLastName ?? ''}`.trim() || null,
    }));
    return success('Washbay queue fetched', items);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function markReadyForRelease(request: FastifyRequest) {
  try {
    const { checkInId } = request.params as any;
    const actorId = await resolveActorId(request);
    if (!actorId) return error(HttpStatus.UNAUTHORIZED, 'Not authenticated');
    const scope = await resolveUserScope(request);

    const [chk] = await db
      .select({ roStatus: vehicleCheckIns.roStatus, shop: vehicleCheckIns.shop })
      .from(vehicleCheckIns)
      .where(eq(vehicleCheckIns.id, checkInId))
      .limit(1);
    if (!chk) return error(HttpStatus.NOT_FOUND, 'Check-in not found');
    if (!checkInInScope(scope, chk.shop as any)) {
      return error(HttpStatus.FORBIDDEN, 'Access denied: this vehicle belongs to another shop.');
    }
    if (chk.roStatus !== 'WASHBAY') {
      return error(
        HttpStatus.BAD_REQUEST,
        `Vehicle is not in washbay (current: ${chk.roStatus}).`,
      );
    }

    await setRoStatus(checkInId, 'READY_FOR_RELEASE', actorId, 'Washbay done');
    return success('Marked ready for release', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
