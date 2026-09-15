import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { lookupByCode, listActive, redeem, uploadLicencePhoto } from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

const send = (fn: (r: FastifyRequest) => Promise<any>) =>
  async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const result = await fn(req);
      const code = (result as any).success?.code || (result as any).error?.code;
      res.status(code).send(result);
    } catch (err) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
    }
  };

export const gatePassRoutes: FastifyPluginAsync = async (app) => {
  app.get('/active',
    { preHandler: [authenticate, checkPermission(MODULES.GATE_RELEASE, ACTIONS.VIEW)] },
    send(listActive));

  app.get('/:code',
    { preHandler: [authenticate, checkPermission(MODULES.GATE_RELEASE, ACTIONS.VIEW)] },
    send(lookupByCode));

  app.post('/:code/redeem',
    { preHandler: [authenticate, checkPermission(MODULES.GATE_RELEASE, ACTIONS.EDIT)] },
    send(redeem));

  app.post('/licence-photo',
    { preHandler: [authenticate, checkPermission(MODULES.GATE_RELEASE, ACTIONS.EDIT)] },
    send(uploadLicencePhoto));
};
