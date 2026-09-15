import { FastifyRequest } from 'fastify';
import { eq, and, or, ilike, count, desc, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import {
  modelServiceTypeAssignments,
  vehicleMakes,
  vehicleModels,
  serviceTypes,
  partsMaster,
  vehicles,
} from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { resolvePartPrices } from '../parts/service';

// Alias for the second join (serviceCategoryId → serviceTypes)
const serviceCategories = alias(serviceTypes, 'serviceCategories');

// ─── List Assignments ───────────────────────────────────────────────────────
export async function listAssignments(request: FastifyRequest) {
  try {
    const {
      makeId,
      modelId,
      serviceTypeId,
      serviceCategoryId,
      search,
      page: pageStr = '1',
      limit: limitStr = '20',
    } = request.query as any;

    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];

    if (makeId) {
      conditions.push(eq(modelServiceTypeAssignments.makeId, makeId));
    }
    if (modelId) {
      conditions.push(eq(modelServiceTypeAssignments.modelId, modelId));
    }
    if (serviceTypeId) {
      // AMC/Scheduled/Paid IDs are stored in serviceCategoryId DB column (frontend saves them swapped)
      conditions.push(eq(modelServiceTypeAssignments.serviceCategoryId, serviceTypeId));
    }
    if (serviceCategoryId) {
      // B/C/D Service IDs are stored in serviceTypeId DB column (frontend saves them swapped)
      conditions.push(eq(modelServiceTypeAssignments.serviceTypeId, serviceCategoryId));
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(modelServiceTypeAssignments.partName, term),
          ilike(modelServiceTypeAssignments.partCode, term),
          ilike(vehicleMakes.name, term),
          ilike(vehicleModels.name, term),
          ilike(serviceTypes.name, term),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ total: count() })
      .from(modelServiceTypeAssignments)
      .innerJoin(vehicleMakes, eq(modelServiceTypeAssignments.makeId, vehicleMakes.id))
      .innerJoin(vehicleModels, eq(modelServiceTypeAssignments.modelId, vehicleModels.id))
      .innerJoin(serviceTypes, eq(modelServiceTypeAssignments.serviceTypeId, serviceTypes.id))
      .leftJoin(serviceCategories, eq(modelServiceTypeAssignments.serviceCategoryId, serviceCategories.id))
      .where(whereClause);

    const rows = await db
      .select({
        id: modelServiceTypeAssignments.id,
        makeId: modelServiceTypeAssignments.makeId,
        makeName: vehicleMakes.name,
        modelId: modelServiceTypeAssignments.modelId,
        modelName: vehicleModels.name,
        // DB service_type_id column stores B/C/D → expose as serviceCategoryId
        serviceCategoryId: modelServiceTypeAssignments.serviceTypeId,
        serviceCategoryName: serviceTypes.name,
        serviceCategoryCode: serviceTypes.code,
        // DB service_category_id column stores AMC/Scheduled/Paid → expose as serviceTypeId
        serviceTypeId: modelServiceTypeAssignments.serviceCategoryId,
        serviceTypeName: serviceCategories.name,
        serviceTypeCode: serviceCategories.code,
        modelCode: modelServiceTypeAssignments.modelCode,
        partCode: modelServiceTypeAssignments.partCode,
        partName: modelServiceTypeAssignments.partName,
        quantity: modelServiceTypeAssignments.quantity,
        unitPrice: modelServiceTypeAssignments.unitPrice,
        createdAt: modelServiceTypeAssignments.createdAt,
      })
      .from(modelServiceTypeAssignments)
      .innerJoin(vehicleMakes, eq(modelServiceTypeAssignments.makeId, vehicleMakes.id))
      .innerJoin(vehicleModels, eq(modelServiceTypeAssignments.modelId, vehicleModels.id))
      .innerJoin(serviceTypes, eq(modelServiceTypeAssignments.serviceTypeId, serviceTypes.id))
      .leftJoin(serviceCategories, eq(modelServiceTypeAssignments.serviceCategoryId, serviceCategories.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(modelServiceTypeAssignments.createdAt));

    const total = Number(totalRow?.total ?? 0);

    return success('Assignments fetched successfully', {
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Assignment ─────────────────────────────────────────────────────────
export async function getAssignment(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [row] = await db
      .select({
        id: modelServiceTypeAssignments.id,
        makeId: modelServiceTypeAssignments.makeId,
        makeName: vehicleMakes.name,
        modelId: modelServiceTypeAssignments.modelId,
        modelName: vehicleModels.name,
        // DB service_type_id column stores B/C/D → expose as serviceCategoryId
        serviceCategoryId: modelServiceTypeAssignments.serviceTypeId,
        serviceCategoryName: serviceTypes.name,
        serviceCategoryCode: serviceTypes.code,
        // DB service_category_id column stores AMC/Scheduled/Paid → expose as serviceTypeId
        serviceTypeId: modelServiceTypeAssignments.serviceCategoryId,
        serviceTypeName: serviceCategories.name,
        serviceTypeCode: serviceCategories.code,
        partName: modelServiceTypeAssignments.partName,
        unitPrice: modelServiceTypeAssignments.unitPrice,
        createdBy: modelServiceTypeAssignments.createdBy,
        createdAt: modelServiceTypeAssignments.createdAt,
        updatedAt: modelServiceTypeAssignments.updatedAt,
      })
      .from(modelServiceTypeAssignments)
      .innerJoin(vehicleMakes, eq(modelServiceTypeAssignments.makeId, vehicleMakes.id))
      .innerJoin(vehicleModels, eq(modelServiceTypeAssignments.modelId, vehicleModels.id))
      .innerJoin(serviceTypes, eq(modelServiceTypeAssignments.serviceTypeId, serviceTypes.id))
      .leftJoin(serviceCategories, eq(modelServiceTypeAssignments.serviceCategoryId, serviceCategories.id))
      .where(eq(modelServiceTypeAssignments.id, id))
      .limit(1);

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Assignment not found');
    }

    return success('Assignment fetched successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create Assignment ──────────────────────────────────────────────────────
export async function createAssignment(request: FastifyRequest) {
  try {
    const { makeId, modelId, serviceTypeId, serviceCategoryId, modelCode, parts } = request.body as any;
    const userId = (request as any).user?.userId;

    // Validate makeId exists
    const [make] = await db
      .select({ id: vehicleMakes.id })
      .from(vehicleMakes)
      .where(eq(vehicleMakes.id, makeId))
      .limit(1);

    if (!make) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid makeId: vehicle make not found');
    }

    // Validate modelId exists
    const [model] = await db
      .select({ id: vehicleModels.id })
      .from(vehicleModels)
      .where(eq(vehicleModels.id, modelId))
      .limit(1);

    if (!model) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid modelId: vehicle model not found');
    }

    // Validate serviceTypeId exists
    const [serviceType] = await db
      .select({ id: serviceTypes.id })
      .from(serviceTypes)
      .where(eq(serviceTypes.id, serviceTypeId))
      .limit(1);

    if (!serviceType) {
      return error(HttpStatus.BAD_REQUEST, 'Invalid serviceTypeId: service type not found');
    }

    // Insert one row per part
    const valuesToInsert = parts.map((part: any) => ({
      makeId,
      modelId,
      serviceTypeId,
      serviceCategoryId: serviceCategoryId ?? null,
      // "Series" (Make → Model → Model Code). Stored so auto-load can match by
      // the stable vehicles.model_code; blank/absent → NULL (legacy fallback).
      modelCode: (modelCode ?? '').trim() || null,
      partCode: part.partCode ?? '',
      partName: part.partName,
      quantity: String(part.quantity ?? 1),
      unitPrice: String(part.unitPrice ?? 0),
      createdBy: userId ?? null,
    }));

    const rows = await db
      .insert(modelServiceTypeAssignments)
      .values(valuesToInsert)
      .returning();

    return created('Assignments created successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Assignment ──────────────────────────────────────────────────────
export async function updateAssignment(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const { partName, partCode, quantity, unitPrice } = request.body as any;

    const updates: Record<string, any> = { updatedAt: new Date() };

    if (partName !== undefined) updates.partName = partName;
    if (partCode !== undefined) updates.partCode = partCode;
    if (quantity !== undefined) updates.quantity = String(quantity);
    if (unitPrice !== undefined) updates.unitPrice = String(unitPrice);

    const [row] = await db
      .update(modelServiceTypeAssignments)
      .set(updates)
      .where(eq(modelServiceTypeAssignments.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Assignment not found');
    }

    return success('Assignment updated successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Assignment ──────────────────────────────────────────────────────
export async function deleteAssignment(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [row] = await db
      .delete(modelServiceTypeAssignments)
      .where(eq(modelServiceTypeAssignments.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Assignment not found');
    }

    return success('Assignment deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── List Parts Master ──────────────────────────────────────────────────────
export async function listParts(_request: FastifyRequest) {
  try {
    const rows = await db
      .select({
        id: partsMaster.id,
        partCode: partsMaster.partCode,
        partName: partsMaster.partName,
        defaultPrice: partsMaster.defaultPrice,
      })
      .from(partsMaster)
      .where(eq(partsMaster.isActive, true))
      .orderBy(partsMaster.partName);

    return success('Parts fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Assignments by Service Category Code ───────────────────────────────
export async function getAssignmentsByCategory(request: FastifyRequest) {
  try {
    const { code } = request.params as any;
    const serviceCategoryId = (request.query as any)?.serviceCategoryId;
    const vehicleIdParam = (request.query as any)?.vehicleId;

    // Find service type by code (e.g. B_SERVICE, C_SERVICE, D_SERVICE)
    const [st] = await db
      .select({ id: serviceTypes.id })
      .from(serviceTypes)
      .where(eq(serviceTypes.code, code))
      .limit(1);

    if (!st) {
      return error(HttpStatus.NOT_FOUND, `Service category "${code}" not found`);
    }

    // Build conditions: always filter by serviceTypeId (B/C/D)
    const conditions = [eq(modelServiceTypeAssignments.serviceTypeId, st.id)];

    // Optionally filter by serviceCategoryId (Scheduled/AMC/Warranty/Paid)
    if (serviceCategoryId) {
      conditions.push(eq(modelServiceTypeAssignments.serviceCategoryId, serviceCategoryId));
    }

    // Optionally filter by vehicleId. Preferred match is by Model Code: the
    // vehicle carries a stable Evolve MM code (vehicles.model_code, e.g.
    // "18665355") and assignments now store the same code, so we match on it
    // directly. This replaces the fragile free-text model-name match that
    // returned zero parts whenever vehicles.model != vehicle_models.name.
    // Fallback: if the vehicle has no model_code (or no assignment carries one),
    // we degrade to the legacy case-insensitive, trimmed model-name match so
    // older data keeps working.
    if (vehicleIdParam) {
      const [vehicle] = await db
        .select({ model: vehicles.model, modelCode: vehicles.modelCode })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleIdParam))
        .limit(1);

      const vehModelCode = (vehicle?.modelCode ?? '').trim();
      if (vehModelCode) {
        conditions.push(eq(modelServiceTypeAssignments.modelCode, vehModelCode));
      } else if (vehicle?.model) {
        // Legacy fallback — normalise both sides (trim + case-insensitive).
        conditions.push(
          eq(sql`lower(trim(${vehicleModels.name}))`, vehicle.model.trim().toLowerCase()),
        );
      }
    }

    const rows = await db
      .select({
        id: modelServiceTypeAssignments.id,
        partCode: modelServiceTypeAssignments.partCode,
        partName: modelServiceTypeAssignments.partName,
        quantity: modelServiceTypeAssignments.quantity,
        unitPrice: modelServiceTypeAssignments.unitPrice,
        makeName: vehicleMakes.name,
        modelName: vehicleModels.name,
        serviceTypeName: serviceTypes.name,
      })
      .from(modelServiceTypeAssignments)
      .innerJoin(vehicleMakes, eq(modelServiceTypeAssignments.makeId, vehicleMakes.id))
      .innerJoin(vehicleModels, eq(modelServiceTypeAssignments.modelId, vehicleModels.id))
      .innerJoin(serviceTypes, eq(modelServiceTypeAssignments.serviceTypeId, serviceTypes.id))
      .where(and(...conditions))
      .orderBy(modelServiceTypeAssignments.createdAt);

    // Price the auto-loaded parts from Evolve (live), falling back to parts_master,
    // then to the stored unit_price. Evolve/parts_master overrides the stored
    // value so the SA always sees the current price.
    if (rows.length > 0) {
      const priceMap = await resolvePartPrices(rows.map((r: any) => r.partCode));
      for (const r of rows as any[]) {
        const resolved = priceMap.get((r.partCode ?? '').trim());
        if (resolved != null) r.unitPrice = String(resolved); // else keep stored price
      }
    }

    return success('Assignments fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
