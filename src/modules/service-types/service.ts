import { FastifyRequest } from 'fastify';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../../db';
import { serviceTypes } from '../../db/models';
import { addServiceTypeSchema, serviceTypeIdParamSchema, updateServiceTypeSchema } from './dto';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── List Service Types ──────────────────────────────────────────────────────
export async function listServiceTypes(request: FastifyRequest) {
  try {
    const category = (request.query as any)?.category;

    const conditions = [eq(serviceTypes.isActive, true)];
    if (category) {
      conditions.push(eq(serviceTypes.category, category));
    } else {
      // Default: only show appointment types (backward compatible)
      conditions.push(eq(serviceTypes.category, 'appointment'));
    }

    const rows = await db
      .select({
        id: serviceTypes.id,
        code: serviceTypes.code,
        name: serviceTypes.name,
        emoji: serviceTypes.emoji,
        category: serviceTypes.category,
        estimatedDurationMinutes: serviceTypes.estimatedDurationMinutes,
        isActive: serviceTypes.isActive,
      })
      .from(serviceTypes)
      .where(and(...conditions))
      .orderBy(asc(serviceTypes.name));

    return success('Service types fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add Service Type ────────────────────────────────────────────────────────
export async function addServiceType(request: FastifyRequest) {
  try {
    const body = request.body as any;

    const [row] = await db
      .insert(serviceTypes)
      .values(body)
      .returning();

    return created('Service type added successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Service Type ─────────────────────────────────────────────────────
export async function updateServiceType(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [row] = await db
      .update(serviceTypes)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(serviceTypes.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Service type not found');
    }

    return success('Service type updated successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Service Type (soft) ──────────────────────────────────────────────
export async function deleteServiceType(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [row] = await db
      .update(serviceTypes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(serviceTypes.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Service type not found');
    }

    return success('Service type deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
