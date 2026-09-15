import { FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { vehicleAccessories, vehicles } from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import {
  addAccessorySchema,
  updateAccessorySchema,
  accessoryParamSchema,
  accessoryIdParamSchema,
} from './dto';

// ─── List Accessories ─────────────────────────────────────────────────────────
export async function listAccessories(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    const accessories = await db
      .select()
      .from(vehicleAccessories)
      .where(
        and(
          eq(vehicleAccessories.vehicleId, vehicleId),
          eq(vehicleAccessories.isActive, true),
        ),
      );

    return success('Accessories fetched successfully', { data: accessories, total: accessories.length });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add Accessory ────────────────────────────────────────────────────────────
export async function addAccessory(request: FastifyRequest) {
  try {
    const { vehicleId } = request.params as any;
    const body = request.body as any;

    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      return error(HttpStatus.NOT_FOUND, 'Vehicle not found');
    }

    const [existing] = await db
      .select({ id: vehicleAccessories.id })
      .from(vehicleAccessories)
      .where(
        and(
          eq(vehicleAccessories.vehicleId, vehicleId),
          eq(vehicleAccessories.accessoryCode, body.accessoryCode),
        ),
      )
      .limit(1);

    if (existing) {
      return error(HttpStatus.CONFLICT, `Accessory code "${body.accessoryCode}" already exists for this vehicle`);
    }

    const [newAccessory] = await db
      .insert(vehicleAccessories)
      .values({ ...body, vehicleId })
      .returning();

    return created('Accessory added successfully', newAccessory);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Accessory ─────────────────────────────────────────────────────────
export async function updateAccessory(request: FastifyRequest) {
  try {
    const { vehicleId, id } = request.params as any;
    const body = request.body as any;

    const [accessory] = await db
      .select()
      .from(vehicleAccessories)
      .where(
        and(
          eq(vehicleAccessories.id, id),
          eq(vehicleAccessories.vehicleId, vehicleId),
        ),
      )
      .limit(1);

    if (!accessory) {
      return error(HttpStatus.NOT_FOUND, 'Accessory not found for this vehicle');
    }

    const [updated] = await db
      .update(vehicleAccessories)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(vehicleAccessories.id, id))
      .returning();

    return success('Accessory updated successfully', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Accessory ─────────────────────────────────────────────────────────
export async function deleteAccessory(request: FastifyRequest) {
  try {
    const { vehicleId, id } = request.params as any;

    const [accessory] = await db
      .select()
      .from(vehicleAccessories)
      .where(
        and(
          eq(vehicleAccessories.id, id),
          eq(vehicleAccessories.vehicleId, vehicleId),
        ),
      )
      .limit(1);

    if (!accessory) {
      return error(HttpStatus.NOT_FOUND, 'Accessory not found for this vehicle');
    }

    await db.delete(vehicleAccessories).where(eq(vehicleAccessories.id, id));

    return success('Accessory deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
