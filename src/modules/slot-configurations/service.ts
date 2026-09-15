import { FastifyRequest } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../db';
import { slotConfigurations } from '../../db/models';
import { addSlotSchema, slotIdParamSchema, updateSlotSchema } from './dto';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── List Slot Configurations ────────────────────────────────────────────────
export async function listSlotConfigurations(_request: FastifyRequest) {
  try {
    const rows = await db
      .select({
        id: slotConfigurations.id,
        time: slotConfigurations.time,
        capacity: slotConfigurations.capacity,
        isActive: slotConfigurations.isActive,
      })
      .from(slotConfigurations)
      .orderBy(asc(slotConfigurations.time));

    return success('Slot configurations fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add Slot Configuration ──────────────────────────────────────────────────
export async function addSlotConfiguration(request: FastifyRequest) {
  try {
    const body = request.body as any;

    const [row] = await db
      .insert(slotConfigurations)
      .values(body)
      .returning();

    return created('Slot configuration added successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Slot Configuration ───────────────────────────────────────────────
export async function updateSlotConfiguration(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [row] = await db
      .update(slotConfigurations)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(slotConfigurations.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Slot configuration not found');
    }

    return success('Slot configuration updated successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Slot Configuration (soft) ────────────────────────────────────────
export async function deleteSlotConfiguration(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [row] = await db
      .update(slotConfigurations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(slotConfigurations.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Slot configuration not found');
    }

    return success('Slot configuration deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
