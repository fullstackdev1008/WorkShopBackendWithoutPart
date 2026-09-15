import { FastifyRequest } from 'fastify';
import { eq, and, ne, count, asc, desc, sql } from 'drizzle-orm';
import { db } from '../../db';
import { labourDescriptions } from '../../db/models';
import {
  createLabourDescriptionSchema,
  updateLabourDescriptionSchema,
  labourDescriptionIdParamSchema,
} from './dto';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── List ──────────────────────────────────────────────────────────────────
// Supports: ?search=, ?status=active|inactive|all (default all), ?active=true
// (dropdown shortcut), and optional ?page/?limit pagination. Ordered newest-first
// (LIFO) by created_at so the most recently added labour appears at the top.
export async function listLabourDescriptions(request: FastifyRequest) {
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
    if (status === 'active' || q.active === 'true') conds.push(eq(labourDescriptions.isActive, true));
    else if (status === 'inactive') conds.push(eq(labourDescriptions.isActive, false));
    if (search) conds.push(sql`lower(${labourDescriptions.name}) LIKE ${'%' + search + '%'}`);
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

    const baseQuery = db
      .select({
        id: labourDescriptions.id,
        name: labourDescriptions.name,
        isActive: labourDescriptions.isActive,
        createdAt: labourDescriptions.createdAt,
        updatedAt: labourDescriptions.updatedAt,
      })
      .from(labourDescriptions)
      .where(where as any)
      // LIFO — newest first; name is a stable tie-break for same-timestamp seeds.
      .orderBy(desc(labourDescriptions.createdAt), asc(labourDescriptions.name));

    const data = paginated ? await baseQuery.limit(limit).offset(offset) : await baseQuery;

    if (!paginated) return success('Labour descriptions fetched successfully', data);

    const [{ total }] = await db.select({ total: count() }).from(labourDescriptions).where(where as any);
    const totalNum = Number(total) || 0;
    return success('Labour descriptions fetched successfully', {
      data,
      pagination: { page, limit, total: totalNum, totalPages: Math.max(1, Math.ceil(totalNum / limit)) },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get by id ───────────────────────────────────────────────────────────────
export async function getLabourDescription(request: FastifyRequest) {
  try {
    const parse = labourDescriptionIdParamSchema.safeParse(request.params);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid id');
    const [row] = await db.select().from(labourDescriptions).where(eq(labourDescriptions.id, parse.data.id)).limit(1);
    if (!row) return error(HttpStatus.NOT_FOUND, 'Labour description not found');
    return success('Labour description fetched successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────
export async function createLabourDescription(request: FastifyRequest) {
  try {
    const parse = createLabourDescriptionSchema.safeParse(request.body);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid request body');
    const { name } = parse.data;

    // Case-insensitive uniqueness.
    const [dupe] = await db
      .select({ id: labourDescriptions.id })
      .from(labourDescriptions)
      .where(sql`lower(${labourDescriptions.name}) = lower(${name})`)
      .limit(1);
    if (dupe) return error(HttpStatus.BAD_REQUEST, `A labour description named "${name}" already exists`);

    const [row] = await db
      .insert(labourDescriptions)
      .values({ name })
      .returning();
    return created('Labour description created successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update (also activate/deactivate via isActive) ──────────────────────────
export async function updateLabourDescription(request: FastifyRequest) {
  try {
    const idParse = labourDescriptionIdParamSchema.safeParse(request.params);
    if (!idParse.success) return error(HttpStatus.BAD_REQUEST, idParse.error.issues[0]?.message ?? 'Invalid id');
    const bodyParse = updateLabourDescriptionSchema.safeParse(request.body);
    if (!bodyParse.success) return error(HttpStatus.BAD_REQUEST, bodyParse.error.issues[0]?.message ?? 'Invalid request body');
    const { id } = idParse.data;
    const body = bodyParse.data;

    const [existing] = await db.select().from(labourDescriptions).where(eq(labourDescriptions.id, id)).limit(1);
    if (!existing) return error(HttpStatus.NOT_FOUND, 'Labour description not found');

    // Name uniqueness (case-insensitive, excluding self) when renaming.
    if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
      const [dupe] = await db
        .select({ id: labourDescriptions.id })
        .from(labourDescriptions)
        .where(and(sql`lower(${labourDescriptions.name}) = lower(${body.name})`, ne(labourDescriptions.id, id)))
        .limit(1);
      if (dupe) return error(HttpStatus.BAD_REQUEST, `A labour description named "${body.name}" already exists`);
    }

    const updates: Partial<typeof labourDescriptions.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    updates.updatedAt = new Date();

    const [row] = await db.update(labourDescriptions).set(updates).where(eq(labourDescriptions.id, id)).returning();
    return success('Labour description updated successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
