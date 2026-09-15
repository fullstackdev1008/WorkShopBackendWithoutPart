import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getEmailSettings, updateEmailSettings, testEmailSettings } from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

const send = (res: FastifyReply, result: any) => {
  const code = result?.success?.code || result?.error?.code || HttpStatus.OK;
  res.status(code).send(result);
};

const getHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    send(res, await getEmailSettings(req));
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    send(res, await updateEmailSettings(req));
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const testHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    send(res, await testEmailSettings(req));
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// Admin-only (ROLE_MANAGEMENT). super-admin bypasses. Mounted at /api/admin/settings.
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/email', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.VIEW)] }, getHandler);
  app.put('/email', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, updateHandler);
  app.post('/email/test', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, testHandler);
};
