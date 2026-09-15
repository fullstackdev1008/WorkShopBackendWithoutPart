import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getDashboard,
  getChecklist,
  getLatestForCheckIn,
  submitInspection,
  uploadInspectionPhoto,
  getCompletedWorks,
  getFailedWorks,
  getQcInItemsForCheckIn,
  getComparison,
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

export const qcOutRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dashboard',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.VIEW)] },
    send(getDashboard));

  app.get('/checklist',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.VIEW)] },
    send(getChecklist));

  app.get('/check-ins/:checkInId/latest',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.VIEW)] },
    send(getLatestForCheckIn));

  // Works Completed list — completed job-card items the inspector must
  // verify before signing out the vehicle.
  app.get('/check-ins/:checkInId/works',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.VIEW)] },
    send(getCompletedWorks));

  // Failed works from the latest QC-out attempt — drives the Foreman
  // rework banner when RO is at QC_FAILED.
  app.get('/check-ins/:checkInId/failed-works',
    { preHandler: [authenticate] },
    send(getFailedWorks));

  app.post('/check-ins/:checkInId/submit',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.CREATE)] },
    send(submitInspection));

  app.post('/photos',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.CREATE)] },
    send(uploadInspectionPhoto));

  // Phase 9 — 3.10 QC checklist parity. Pull the QC In items for this
  // check-in to use as the QC Out template, then compare results.
  app.get('/check-ins/:checkInId/qc-in-items',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.VIEW)] },
    send(getQcInItemsForCheckIn));

  app.get('/check-ins/:checkInId/comparison',
    { preHandler: [authenticate, checkPermission(MODULES.QC_OUT, ACTIONS.VIEW)] },
    send(getComparison));
};
