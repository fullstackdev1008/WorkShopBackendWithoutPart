import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { dumpDatabase, loadDatabase } from './service';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/appError';

// Dump/load can read or overwrite the entire DB — disabled in production
// (R14, Phase 7). Dev-only utility.
const blockInProd = async (_req: FastifyRequest, _res: FastifyReply) => {
  if (env.NODE_ENV === 'production') {
    throw new AppError(403, 'This endpoint is disabled in production.');
  }
};

// ─── Handlers ────────────────────────────────────────────────────────────────

const dumpDatabaseHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await dumpDatabase(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const loadDatabaseHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await loadDatabase(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const dbDumpRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/db/dump  → fetch all tables and write to public/load_data.json
  app.get('/dump', { preHandler: [blockInProd] }, dumpDatabaseHandler);

  // POST /api/db/load → read public/load_data.json and insert into DB
  app.post('/load', { preHandler: [blockInProd] }, loadDatabaseHandler);
};
