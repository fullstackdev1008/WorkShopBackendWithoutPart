import { FastifyRequest } from 'fastify';
import { and, eq, isNotNull, isNull, or, asc } from 'drizzle-orm';
import { db } from '../../db';
import { franchiseServiceDepartments } from '../../db/models';
import { success, created, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { createFsdSchema, updateFsdSchema, fsdIdParamSchema, listFsdQuerySchema } from './dto';

const isUniqueViolation = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { code?: string }).code === '23505';

/**
 * GET /api/franchise-service-depts
 *   ?scope=labeled (default) → active, fully-labeled pairs — the job-card
 *     Franchise/Service-Dept dropdown source.
 *   ?scope=all → every cached pair (incl. unlabeled/inactive) for admin labeling.
 */
export async function listFsd(request: FastifyRequest) {
  try {
    const parse = listFsdQuerySchema.safeParse(request.query ?? {});
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid query');
    const all = parse.data.scope === 'all';
    const { companyId } = parse.data;

    // Company filter. A pair belongs to the company whose Evolve InterfaceCode
    // returned it; rows with a NULL company_id predate per-company sync and are
    // shown to everyone so the dropdown never goes empty mid-rollout. Once a
    // company has its own synced pairs, those are the only scoped ones it sees.
    //
    // Skipped for scope=all: the admin screen must see every row, including
    // other companies', to label them.
    const companyFilter =
      !all && companyId
        ? or(
            eq(franchiseServiceDepartments.companyId, companyId),
            isNull(franchiseServiceDepartments.companyId),
          )
        : undefined;

    const rows = await db
      .select({
        id: franchiseServiceDepartments.id,
        companyId: franchiseServiceDepartments.companyId,
        franchiseSeqId: franchiseServiceDepartments.franchiseSeqId,
        sdNumber: franchiseServiceDepartments.sdNumber,
        franchiseLabel: franchiseServiceDepartments.franchiseLabel,
        serviceDeptLabel: franchiseServiceDepartments.serviceDeptLabel,
        isActive: franchiseServiceDepartments.isActive,
      })
      .from(franchiseServiceDepartments)
      .where(
        all
          ? (undefined as any)
          : and(
              eq(franchiseServiceDepartments.isActive, true),
              isNotNull(franchiseServiceDepartments.franchiseLabel),
              isNotNull(franchiseServiceDepartments.serviceDeptLabel),
              ...(companyFilter ? [companyFilter] : []),
            ),
      )
      .orderBy(asc(franchiseServiceDepartments.franchiseLabel), asc(franchiseServiceDepartments.serviceDeptLabel));

    return success('Franchise service departments fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Create (manual add of a pair, e.g. if sync hasn't run) ──────────────────
export async function createFsd(request: FastifyRequest) {
  try {
    const parse = createFsdSchema.safeParse(request.body);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid request body');
    const { franchiseSeqId, sdNumber, franchiseLabel, serviceDeptLabel, isActive } = parse.data;

    try {
      const [row] = await db
        .insert(franchiseServiceDepartments)
        .values({
          franchiseSeqId,
          sdNumber,
          franchiseLabel: franchiseLabel ?? null,
          serviceDeptLabel: serviceDeptLabel ?? null,
          ...(isActive === undefined ? {} : { isActive }),
        })
        .returning();
      return created('Franchise service department created successfully', row);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return error(
          HttpStatus.CONFLICT,
          `A pair with FranchiseSeqID "${franchiseSeqId}" / SDNumber "${sdNumber}" already exists`,
        );
      }
      throw e;
    }
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update (assign labels, change numbers, enable/disable) ──────────────────
export async function updateFsd(request: FastifyRequest) {
  try {
    const idParse = fsdIdParamSchema.safeParse(request.params);
    if (!idParse.success) return error(HttpStatus.BAD_REQUEST, idParse.error.issues[0]?.message ?? 'Invalid id');
    const bodyParse = updateFsdSchema.safeParse(request.body);
    if (!bodyParse.success) return error(HttpStatus.BAD_REQUEST, bodyParse.error.issues[0]?.message ?? 'Invalid request body');
    const { id } = idParse.data;
    const body = bodyParse.data;

    const [existing] = await db.select().from(franchiseServiceDepartments).where(eq(franchiseServiceDepartments.id, id)).limit(1);
    if (!existing) return error(HttpStatus.NOT_FOUND, 'Franchise service department not found');

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.franchiseSeqId !== undefined) set.franchiseSeqId = body.franchiseSeqId;
    if (body.sdNumber !== undefined) set.sdNumber = body.sdNumber;
    if (body.franchiseLabel !== undefined) set.franchiseLabel = body.franchiseLabel;
    if (body.serviceDeptLabel !== undefined) set.serviceDeptLabel = body.serviceDeptLabel;
    if (body.isActive !== undefined) set.isActive = body.isActive;

    try {
      const [row] = await db
        .update(franchiseServiceDepartments)
        .set(set)
        .where(eq(franchiseServiceDepartments.id, id))
        .returning();
      return success('Franchise service department updated successfully', row);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return error(HttpStatus.CONFLICT, 'Another pair with that FranchiseSeqID / SDNumber already exists');
      }
      throw e;
    }
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────
export async function deleteFsd(request: FastifyRequest) {
  try {
    const parse = fsdIdParamSchema.safeParse(request.params);
    if (!parse.success) return error(HttpStatus.BAD_REQUEST, parse.error.issues[0]?.message ?? 'Invalid id');
    const rows = await db
      .delete(franchiseServiceDepartments)
      .where(eq(franchiseServiceDepartments.id, parse.data.id))
      .returning({ id: franchiseServiceDepartments.id });
    if (rows.length === 0) return error(HttpStatus.NOT_FOUND, 'Franchise service department not found');
    return success('Franchise service department deleted successfully', { id: parse.data.id });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
