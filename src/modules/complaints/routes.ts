import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listComplaints,
  addComplaint,
  updateComplaint,
  deleteComplaint,
} from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listComplaintsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listComplaints(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addComplaintHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addComplaint(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateComplaintHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateComplaint(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteComplaintHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteComplaint(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const complaintRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate] }, listComplaintsHandler);
  app.post('/', { preHandler: [authenticate] }, addComplaintHandler);
  app.put('/:id', { preHandler: [authenticate] }, updateComplaintHandler);
  app.delete('/:id', { preHandler: [authenticate] }, deleteComplaintHandler);
};
