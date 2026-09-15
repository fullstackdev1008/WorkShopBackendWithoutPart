import { FastifyRequest } from 'fastify';
import { eq, and, ne, asc, sql } from 'drizzle-orm';
import { db } from '../../db';
import { jobTypes } from '../../db/models';
import { success, created, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { createJobTypeSchema, updateJobTypeSchema, jobTypeIdParamSchema, listJobTypeQuerySchema } from './dto';

/**
 * GET /api/job-types — Evolve Job Types for the Create Job Card dropdown (and,
 * with ?status=all, the admin management view).
 *
 * Default (no query / ?status=active) returns only active rows — the unchanged
 * behaviour the FE dropdown relies on. ?status=all returns every row so an admin
 * can see and re-enable deactivated types. Nothing is invented here; the table
 * is populated by an admin (CRUD below) or the optional seed script.
 */
export async function listJobTypes(request: FastifyRequest) {
  try {
    const parse = listJobTypeQuerySchema.safeParse(request.query ?? {});
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid query');
    const includeInactive = parse.data.status === 'all';

    const rows = await db
      .select({ id: jobTypes.id, code: jobTypes.code, name: jobTypes.name, isActive: jobTypes.isActive })
      .from(jobTypes)
      .where(includeInactive ? (undefined as any) : eq(jobTypes.isActive, true))
      .orderBy(asc(jobTypes.name));

    return success('Job types fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────
export async function createJobType(request: FastifyRequest) {
  try {
    const parse = createJobTypeSchema.safeParse(request.body);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid request body');
    const { code, name, isActive } = parse.data;

    // Case-insensitive uniqueness on code (the RO <JobType> value).
    const [dupe] = await db
      .select({ id: jobTypes.id })
      .from(jobTypes)
      .where(sql`lower(${jobTypes.code}) = lower(${code})`)
      .limit(1);
    if (dupe) return error(HttpStatus.CONFLICT, `A job type with code "${code}" already exists`, 'code');

    try {
      const [row] = await db
        .insert(jobTypes)
        .values({ code, name, ...(isActive === undefined ? {} : { isActive }) })
        .returning();
      return created('Job type created successfully', row);
    } catch (e) {
      // The uq_job_types_code index is the atomic guard; translate a lost race
      // (SQLSTATE 23505) into a clean 409. Any other error propagates.
      if (e && typeof e === 'object' && (e as { code?: string }).code === '23505') {
        return error(HttpStatus.CONFLICT, `A job type with code "${code}" already exists`, 'code');
      }
      throw e;
    }
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update (also enable/disable via isActive) ───────────────────────────────
export async function updateJobType(request: FastifyRequest) {
  try {
    const idParse = jobTypeIdParamSchema.safeParse(request.params);
    if (!idParse.success) return error(HttpStatus.BAD_REQUEST, idParse.error.issues[0]?.message ?? 'Invalid id');
    const bodyParse = updateJobTypeSchema.safeParse(request.body);
    if (!bodyParse.success) return error(HttpStatus.BAD_REQUEST, bodyParse.error.issues[0]?.message ?? 'Invalid request body');
    const { id } = idParse.data;
    const body = bodyParse.data;

    const [existing] = await db.select().from(jobTypes).where(eq(jobTypes.id, id)).limit(1);
    if (!existing) return error(HttpStatus.NOT_FOUND, 'Job type not found');

    // Code uniqueness (case-insensitive, excluding self) when changing the code.
    if (body.code && body.code.toLowerCase() !== existing.code.toLowerCase()) {
      const [dupe] = await db
        .select({ id: jobTypes.id })
        .from(jobTypes)
        .where(and(sql`lower(${jobTypes.code}) = lower(${body.code})`, ne(jobTypes.id, id)))
        .limit(1);
      if (dupe) return error(HttpStatus.CONFLICT, `A job type with code "${body.code}" already exists`, 'code');
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.code !== undefined) set.code = body.code;
    if (body.name !== undefined) set.name = body.name;
    if (body.isActive !== undefined) set.isActive = body.isActive;

    try {
      const [row] = await db.update(jobTypes).set(set).where(eq(jobTypes.id, id)).returning();
      return success('Job type updated successfully', row);
    } catch (e) {
      if (e && typeof e === 'object' && (e as { code?: string }).code === '23505') {
        return error(HttpStatus.CONFLICT, `A job type with code "${body.code}" already exists`, 'code');
      }
      throw e;
    }
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
