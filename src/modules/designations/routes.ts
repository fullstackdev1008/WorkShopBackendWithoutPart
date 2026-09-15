import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listDesignations,
  getDesignation,
  createDesignation,
  updateDesignation,
} from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────
const listHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listDesignations(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getDesignation(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createDesignation(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateDesignation(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────
// Admin-managed master data — gated by ROLE_MANAGEMENT (same as User Management).
// Activate/deactivate is done via PUT (isActive) — no hard delete (master data).
export const designationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.VIEW)] }, listHandler);
  app.get('/:id', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.VIEW)] }, getHandler);
  app.post('/', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.CREATE)] }, createHandler);
  app.put('/:id', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, updateHandler);
};
