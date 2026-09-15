import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getDashboard,
  getPartRequests,
  markAvailable,
  markUnavailable,
  markDispatched,
  listPartsPendingAcceptance,
  acceptDispatchedPart,
  rejectDispatchedPart,
} from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const getDashboardHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getDashboard(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getPartRequestsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getPartRequests(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const markAvailableHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await markAvailable(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const markUnavailableHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await markUnavailable(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const markDispatchedHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await markDispatched(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listPendingAcceptanceHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listPartsPendingAcceptance(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const acceptDispatchedPartHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await acceptDispatchedPart(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const rejectDispatchedPartHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await rejectDispatchedPart(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const partsManagerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dashboard', { preHandler: [authenticate, checkPermission(MODULES.PARTS_MANAGER, ACTIONS.VIEW)] }, getDashboardHandler);
  app.get('/parts', { preHandler: [authenticate, checkPermission(MODULES.PARTS_MANAGER, ACTIONS.VIEW)] }, getPartRequestsHandler);
  app.put('/parts/:partId/mark-available', { preHandler: [authenticate, checkPermission(MODULES.PARTS_MANAGER, ACTIONS.EDIT)] }, markAvailableHandler);
  app.put('/parts/:partId/mark-unavailable', { preHandler: [authenticate, checkPermission(MODULES.PARTS_MANAGER, ACTIONS.EDIT)] }, markUnavailableHandler);
  app.put('/parts/:partId/mark-dispatched', { preHandler: [authenticate, checkPermission(MODULES.PARTS_MANAGER, ACTIONS.EDIT)] }, markDispatchedHandler);

  // Technician acceptance/rejection — gated by TECHNICIAN module, not PARTS_MANAGER,
  // so the parts manager can't accept on behalf of the technician (physical handover proof).
  app.get('/parts/pending-acceptance', { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] }, listPendingAcceptanceHandler);
  app.post('/parts/:partId/accept', { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.EDIT)] }, acceptDispatchedPartHandler);
  app.post('/parts/:partId/reject', { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.EDIT)] }, rejectDispatchedPartHandler);
};
