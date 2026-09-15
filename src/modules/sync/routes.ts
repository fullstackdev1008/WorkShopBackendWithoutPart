import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { triggerMasterDataSync, getEvolveSyncHealth, requeueJobCardSync } from './service';
import { authenticate, authorize } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const sendResult = (res: FastifyReply, result: unknown) => {
  const code = (result as any)?.success?.code || (result as any)?.error?.code || HttpStatus.OK;
  res.status(code).send(result);
};

const triggerMasterDataSyncHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    sendResult(res, await triggerMasterDataSync(req));
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const evolveHealthHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    sendResult(res, await getEvolveSyncHealth(req));
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const requeueJobCardHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    sendResult(res, await requeueJobCardSync(req));
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const syncRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/sync/master-data — admin only
  app.post('/master-data', { preHandler: [authenticate, authorize(['super-admin'])] }, triggerMasterDataSyncHandler);

  // GET /api/sync/evolve-health — Evolve sync mode, schema readiness, status counts
  app.get('/evolve-health', { preHandler: [authenticate, authorize(['super-admin'])] }, evolveHealthHandler);

  // POST /api/sync/job-card/:id/requeue — re-queue a NEEDS_MANUAL / unsynced card
  app.post('/job-card/:id/requeue', { preHandler: [authenticate, authorize(['super-admin'])] }, requeueJobCardHandler);
};
