import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { runSeed } from './service';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/appError';

// Dev-only utility — disabled in production (R14, Phase 7). Real environments
// seed via the db:seed CLI script, never the public HTTP route.
const blockInProd = async (_req: FastifyRequest, _res: FastifyReply) => {
  if (env.NODE_ENV === 'production') {
    throw new AppError(403, 'This endpoint is disabled in production.');
  }
};

const seedHandler = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await runSeed();
    res.status(200).send({
      success: { status: true, code: 200, message: 'Default data seeded successfully' },
      data: result,
      error: null,
    });
  } catch (err: any) {
    res.status(500).send({
      success: null,
      data: null,
      error: { status: false, code: 500, message: err?.message ?? 'Seed failed' },
    });
  }
};

export const seedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [blockInProd] }, seedHandler);
};
