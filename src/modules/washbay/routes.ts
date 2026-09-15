import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { listAwaiting, markReadyForRelease } from './service';
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

export const washbayRoutes: FastifyPluginAsync = async (app) => {
  app.get('/queue',
    { preHandler: [authenticate, checkPermission(MODULES.WASHBAY, ACTIONS.VIEW)] },
    send(listAwaiting));

  app.post('/check-ins/:checkInId/ready',
    { preHandler: [authenticate, checkPermission(MODULES.WASHBAY, ACTIONS.EDIT)] },
    send(markReadyForRelease));
};
