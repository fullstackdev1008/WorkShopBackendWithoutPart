import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listInventory,
  getOne,
  submitForApproval,
  approve,
  reject,
  scrap,
  manualCreate,
  tagHtml,
} from './service';
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

export const warrantyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/parts',
    { preHandler: [authenticate, checkPermission(MODULES.WARRANTY, ACTIONS.VIEW)] },
    send(listInventory));

  app.get('/parts/:id',
    { preHandler: [authenticate, checkPermission(MODULES.WARRANTY, ACTIONS.VIEW)] },
    send(getOne));

  app.post('/parts',
    { preHandler: [authenticate, checkPermission(MODULES.WARRANTY, ACTIONS.EDIT)] },
    send(manualCreate));

  app.post('/parts/:id/submit',
    { preHandler: [authenticate, checkPermission(MODULES.WARRANTY, ACTIONS.EDIT)] },
    send(submitForApproval));
  app.post('/parts/:id/approve',
    { preHandler: [authenticate, checkPermission(MODULES.WARRANTY, ACTIONS.EDIT)] },
    send(approve));
  app.post('/parts/:id/reject',
    { preHandler: [authenticate, checkPermission(MODULES.WARRANTY, ACTIONS.EDIT)] },
    send(reject));
  app.post('/parts/:id/scrap',
    { preHandler: [authenticate, checkPermission(MODULES.WARRANTY, ACTIONS.EDIT)] },
    send(scrap));

  // Printable tag — auth-required but no permission gate (any logged-in
  // user can re-print a tag for a part they have a UI route to).
  app.get('/parts/:id/tag.html',
    { preHandler: [authenticate] },
    async (req, res) => { await tagHtml(req, res); });
};
