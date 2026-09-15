import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { listFsd, createFsd, updateFsd, deleteFsd } from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

const listHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listFsd(req);
    const code = (result as any).success?.code || (result as any).error?.code || HttpStatus.OK;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createFsd(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateFsd(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteFsd(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

export const franchiseServiceDeptRoutes: FastifyPluginAsync = async (app) => {
  // GET — dropdown source (?scope=labeled, default) / admin list (?scope=all).
  // Any authenticated user can read (the job-card screen needs it); writes are
  // gated by ROLE_MANAGEMENT like other master data.
  app.get('/', { preHandler: [authenticate] }, listHandler);
  app.post('/', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.CREATE)] }, createHandler);
  app.put('/:id', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, updateHandler);
  app.delete('/:id', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.DELETE)] }, deleteHandler);
};
