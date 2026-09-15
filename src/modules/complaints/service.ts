import { FastifyRequest } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../db';
import { complaints } from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

// ─── List Complaints ─────────────────────────────────────────────────────────
export async function listComplaints(_request: FastifyRequest) {
  try {
    const rows = await db
      .select({
        id: complaints.id,
        name: complaints.name,
        isActive: complaints.isActive,
      })
      .from(complaints)
      .where(eq(complaints.isActive, true))
      .orderBy(asc(complaints.name));

    return success('Complaints fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Add Complaint ───────────────────────────────────────────────────────────
export async function addComplaint(request: FastifyRequest) {
  try {
    const { name } = request.body as any;

    const [row] = await db
      .insert(complaints)
      .values({ name })
      .returning();

    return created('Complaint added successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Complaint ────────────────────────────────────────────────────────
export async function updateComplaint(request: FastifyRequest) {
  try {
    const { id } = request.params as any;
    const body = request.body as any;

    const [row] = await db
      .update(complaints)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(complaints.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Complaint not found');
    }

    return success('Complaint updated successfully', row);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Delete Complaint (soft) ─────────────────────────────────────────────────
export async function deleteComplaint(request: FastifyRequest) {
  try {
    const { id } = request.params as any;

    const [row] = await db
      .update(complaints)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(complaints.id, id))
      .returning();

    if (!row) {
      return error(HttpStatus.NOT_FOUND, 'Complaint not found');
    }

    return success('Complaint deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
