import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listLabourDescriptions,
  getLabourDescription,
  createLabourDescription,
  updateLabourDescription,
} from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────
const listHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listLabourDescriptions(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getLabourDescription(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createLabourDescription(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateLabourDescription(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────
// The Labour Master is a Job Card lookup, so read + create are open to any
// authenticated user (a service advisor can add a labour type on the fly while
// building a job card) — matching the job-types / service-types lookups. Editing
// and activate/deactivate remain admin-only (ROLE_MANAGEMENT). No hard delete.
export const labourDescriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate] }, listHandler);
  app.get('/:id', { preHandler: [authenticate] }, getHandler);
  app.post('/', { preHandler: [authenticate] }, createHandler);
  app.put('/:id', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, updateHandler);
};
