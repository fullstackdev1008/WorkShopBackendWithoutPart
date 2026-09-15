import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listParts,
  getAssignmentsByCategory,
} from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listAssignmentsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listAssignments(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getAssignmentHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getAssignment(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createAssignmentHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createAssignment(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateAssignmentHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateAssignment(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteAssignmentHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteAssignment(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listPartsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listParts(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getAssignmentsByCategoryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getAssignmentsByCategory(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const modelServiceTypeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate] }, listAssignmentsHandler);
  app.get('/parts', { preHandler: [authenticate] }, listPartsHandler);
  app.get('/by-category/:code', { preHandler: [authenticate] }, getAssignmentsByCategoryHandler);
  app.get('/:id', { preHandler: [authenticate] }, getAssignmentHandler);
  app.post('/', { preHandler: [authenticate] }, createAssignmentHandler);
  app.put('/:id', { preHandler: [authenticate] }, updateAssignmentHandler);
  app.delete('/:id', { preHandler: [authenticate] }, deleteAssignmentHandler);
};
