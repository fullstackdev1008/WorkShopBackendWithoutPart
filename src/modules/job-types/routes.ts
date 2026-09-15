import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { listJobTypes, createJobType, updateJobType } from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

const listJobTypesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listJobTypes(req);
    const code = (result as any).success?.code || (result as any).error?.code || HttpStatus.OK;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createJobTypeHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createJobType(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateJobTypeHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateJobType(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

export const jobTypeRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/job-types — active Job Types for the Create Job Card selector
  // (any authenticated user). ?status=all → include inactive (admin view).
  app.get('/', { preHandler: [authenticate] }, listJobTypesHandler);
  // Admin management — gated by ROLE_MANAGEMENT (same as other master data).
  // Enable/disable is done via PUT (isActive) — no hard delete (RO history may
  // reference a code, and Evolve codes are a fixed vocabulary).
  app.post('/', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.CREATE)] }, createJobTypeHandler);
  app.put('/:id', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, updateJobTypeHandler);
};
