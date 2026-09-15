import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getEstimateByToken,
  approveEstimateByToken,
  requestModificationByToken,
  rejectEstimateByToken,
} from './service';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const getEstimateByTokenHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getEstimateByToken(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const approveEstimateByTokenHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await approveEstimateByToken(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const requestModificationByTokenHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await requestModificationByToken(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const rejectEstimateByTokenHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await rejectEstimateByToken(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

// Public routes — NO authentication required
export const customerApprovalRoutes: FastifyPluginAsync = async (app) => {
  app.get('/estimate/:token', getEstimateByTokenHandler);
  app.post('/estimate/:token/approve', approveEstimateByTokenHandler);
  app.post('/estimate/:token/request-modification', requestModificationByTokenHandler);
  app.post('/estimate/:token/reject', rejectEstimateByTokenHandler);
};
