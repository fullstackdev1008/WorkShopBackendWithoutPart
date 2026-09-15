import { FastifyRequest } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../db';
import { qcChecklistTemplates } from '../../db/models';
import {
  addQcChecklistTemplateSchema,
  updateQcChecklistTemplateSchema,
  qcChecklistTemplateIdParamSchema,
} from './dto';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── List QC Checklist Templates ─────────────────────────────────────────────
export async function listQcChecklistTemplates(_request: FastifyRequest) {
  try {
    const rows = await db
      .select({
        id: qcChecklistTemplates.id,
        category: qcChecklistTemplates.category,
        subCategory: qcChecklistTemplates.subCategory,
        itemCode: qcChecklistTemplates.itemCode,
        itemLabel: qcChecklistTemplates.itemLabel,
        sortOrder: qcChecklistTemplates.sortOrder,
        isActive: qcChecklistTemplates.isActive,
      })
      .from(qcChecklistTemplates)
      .where(eq(qcChecklistTemplates.isActive, true))
      .orderBy(asc(qcChecklistTemplates.category), asc(qcChecklistTemplates.sortOrder));

    return success('QC checklist templates fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add QC Checklist Template ───────────────────────────────────────────────
export async function addQcChecklistTemplate(request: FastifyRequest) {
  try {
    const body = request.body as any;

    const [row] = await db
      .insert(qcChecklistTemplates)
      .values(body)
      .returning();

    return created('QC checklist template added successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update QC Checklist Template ────────────────────────────────────────────
export async function updateQcChecklistTemplate(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [row] = await db
      .update(qcChecklistTemplates)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(qcChecklistTemplates.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Template not found');
    }

    return success('QC checklist template updated successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete QC Checklist Template (soft) ─────────────────────────────────────
export async function deleteQcChecklistTemplate(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [row] = await db
      .update(qcChecklistTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(qcChecklistTemplates.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Template not found');
    }

    return success('QC checklist template deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
