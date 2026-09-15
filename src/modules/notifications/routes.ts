import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { listMyNotifications, markRead, markAllRead } from './service';
import { authenticate } from '../../shared/security/auth.middleware';
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

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  // Any authenticated user can read their own notifications.
  app.get('/', { preHandler: [authenticate] }, send(listMyNotifications));
  app.post('/:id/read', { preHandler: [authenticate] }, send(markRead));
  app.post('/mark-all-read', { preHandler: [authenticate] }, send(markAllRead));
};
