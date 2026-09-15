import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { searchParts } from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const searchPartsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await searchParts(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const partsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', { preHandler: [authenticate] }, searchPartsHandler);
};
