import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listReadyForBilling,
  buildPreview,
  generate,
  getOne,
  recordPayment,
  voidInvoice,
  invoiceHtml,
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

export const invoicingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ready-for-billing',
    { preHandler: [authenticate, checkPermission(MODULES.INVOICING, ACTIONS.VIEW)] },
    send(listReadyForBilling));

  app.get('/job-cards/:jobCardId/preview',
    { preHandler: [authenticate, checkPermission(MODULES.INVOICING, ACTIONS.VIEW)] },
    send(buildPreview));

  app.post('/job-cards/:jobCardId/generate',
    { preHandler: [authenticate, checkPermission(MODULES.INVOICING, ACTIONS.CREATE)] },
    send(generate));

  app.get('/:id',
    { preHandler: [authenticate, checkPermission(MODULES.INVOICING, ACTIONS.VIEW)] },
    send(getOne));

  app.post('/:id/payments',
    { preHandler: [authenticate, checkPermission(MODULES.INVOICING, ACTIONS.EDIT)] },
    send(recordPayment));

  app.post('/:id/void',
    { preHandler: [authenticate, checkPermission(MODULES.INVOICING, ACTIONS.DELETE)] },
    send(voidInvoice));

  // Printable invoice — auth required but no fine-grained permission gate
  // (matches the warranty tag convention).
  app.get('/:id/print.html',
    { preHandler: [authenticate] },
    async (req, res) => { await invoiceHtml(req, res); });
};
