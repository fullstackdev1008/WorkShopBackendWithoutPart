import { FastifyRequest } from 'fastify';
import { eq, and, ne, count, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { designations, users } from '../../db/models';
import {
  createDesignationSchema,
  updateDesignationSchema,
  designationIdParamSchema,
} from './dto';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── List ──────────────────────────────────────────────────────────────────
// Supports: ?search=, ?status=active|inactive|all (default all), ?active=true
// (dropdown shortcut), and optional ?page/?limit pagination. Each row carries
// assignedUserCount so the admin can be warned before deactivating.
export async function listDesignations(request: FastifyRequest) {
  try {
    const q = (request.query ?? {}) as {
      search?: string;
      status?: string;
      active?: string;
      page?: string | number;
      limit?: string | number;
    };
    const paginated = q.page != null || q.limit != null;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;
    const search = (q.search ?? '').trim().toLowerCase();
    const status = (q.status ?? '').toLowerCase();

    const conds: any[] = [];
    if (status === 'active' || q.active === 'true') conds.push(eq(designations.isActive, true));
    else if (status === 'inactive') conds.push(eq(designations.isActive, false));
    if (search) conds.push(sql`lower(${designations.name}) LIKE ${'%' + search + '%'}`);
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

    const baseQuery = db
      .select({
        id: designations.id,
        name: designations.name,
        description: designations.description,
        isActive: designations.isActive,
        createdAt: designations.createdAt,
      })
      .from(designations)
      .where(where as any)
      .orderBy(designations.name);

    const rows = paginated ? await baseQuery.limit(limit).offset(offset) : await baseQuery;

    // Assigned (non-deleted) user counts, keyed per designation.
    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await db
          .select({ designationId: users.designationId, total: count() })
          .from(users)
          .where(and(eq(users.isDeleted, false), inArray(users.designationId, ids)))
          .groupBy(users.designationId)
      : [];
    const countMap = new Map(counts.map((c: any) => [c.designationId, Number(c.total)]));

    const data = rows.map((r) => ({ ...r, assignedUserCount: countMap.get(r.id) ?? 0 }));

    if (!paginated) return success('Designations fetched successfully', data);

    const [{ total }] = await db.select({ total: count() }).from(designations).where(where as any);
    const totalNum = Number(total) || 0;
    return success('Designations fetched successfully', {
      data,
      pagination: { page, limit, total: totalNum, totalPages: Math.max(1, Math.ceil(totalNum / limit)) },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get by id ───────────────────────────────────────────────────────────────
export async function getDesignation(request: FastifyRequest) {
  try {
    const parse = designationIdParamSchema.safeParse(request.params);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid id');
    const [row] = await db.select().from(designations).where(eq(designations.id, parse.data.id)).limit(1);
    if (!row) return error(HttpStatus.NOT_FOUND, 'Designation not found');
    return success('Designation fetched successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────
export async function createDesignation(request: FastifyRequest) {
  try {
    const parse = createDesignationSchema.safeParse(request.body);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid request body');
    const { name, description } = parse.data;

    // Case-insensitive uniqueness.
    const [dupe] = await db
      .select({ id: designations.id })
      .from(designations)
      .where(sql`lower(${designations.name}) = lower(${name})`)
      .limit(1);
    if (dupe) return error(HttpStatus.BAD_REQUEST, `A designation named "${name}" already exists`);

    const [row] = await db
      .insert(designations)
      .values({ name, description: description ?? null })
      .returning();
    return created('Designation created successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update (also activate/deactivate via isActive) ──────────────────────────
export async function updateDesignation(request: FastifyRequest) {
  try {
    const idParse = designationIdParamSchema.safeParse(request.params);
    if (!idParse.success) return error(HttpStatus.BAD_REQUEST, idParse.error.issues[0]?.message ?? 'Invalid id');
    const bodyParse = updateDesignationSchema.safeParse(request.body);
    if (!bodyParse.success) return error(HttpStatus.BAD_REQUEST, bodyParse.error.issues[0]?.message ?? 'Invalid request body');
    const { id } = idParse.data;
    const body = bodyParse.data;

    const [existing] = await db.select().from(designations).where(eq(designations.id, id)).limit(1);
    if (!existing) return error(HttpStatus.NOT_FOUND, 'Designation not found');

    // Name uniqueness (case-insensitive, excluding self) when renaming.
    if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
      const [dupe] = await db
        .select({ id: designations.id })
        .from(designations)
        .where(and(sql`lower(${designations.name}) = lower(${body.name})`, ne(designations.id, id)))
        .limit(1);
      if (dupe) return error(HttpStatus.BAD_REQUEST, `A designation named "${body.name}" already exists`);
    }

    const updates: Partial<typeof designations.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description ?? null;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    updates.updatedAt = new Date();

    const [row] = await db.update(designations).set(updates).where(eq(designations.id, id)).returning();
    return success('Designation updated successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
