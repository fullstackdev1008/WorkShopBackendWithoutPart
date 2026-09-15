import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listBays,
  createBay,
  updateBay,
  deleteBay,
  getDashboard,
  allocateToBay,
  reallocate,
  releaseAllocation,
  signOffJobCard,
  rejectJobCard,
  listJobCardsAwaitingSignOff,
  foremanUpdateWriteUp,
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

export const workshopRoutes: FastifyPluginAsync = async (app) => {
  // Foreman dashboard
  app.get('/dashboard',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.VIEW)] },
    send(getDashboard));

  // Bay master CRUD
  app.get('/bays',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.VIEW)] },
    send(listBays));
  app.post('/bays',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.CREATE)] },
    send(createBay));
  app.put('/bays/:id',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    send(updateBay));
  app.delete('/bays/:id',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    send(deleteBay));

  // Allocation actions — keyed by check-in id (not vehicle id) so re-entries
  // get their own allocation history.
  app.post('/check-ins/:checkInId/allocate',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.CREATE)] },
    send(allocateToBay));
  app.post('/check-ins/:checkInId/reallocate',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    send(reallocate));
  app.post('/check-ins/:checkInId/release',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    send(releaseAllocation));

  // Foreman sign-off flow (Phase 7 — 3.9). Cards in FOREMAN_REVIEW are
  // technician-done but not yet QC-eligible until the foreman signs.
  app.get('/job-cards/awaiting-sign-off',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.VIEW)] },
    send(listJobCardsAwaitingSignOff));
  app.post('/job-cards/:jobCardId/sign-off',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    send(signOffJobCard));
  app.post('/job-cards/:jobCardId/reject',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    send(rejectJobCard));

  // Foreman/supervisor write-up edit access (3.8). Lets a supervisor edit
  // the Cause / Correction text on any item — useful when reviewing for
  // QC handoff or clarifying tech notes before customer-facing artifacts.
  app.patch('/items/:itemId/write-up',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    send(foremanUpdateWriteUp));
};
