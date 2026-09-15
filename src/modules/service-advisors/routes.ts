import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getDashboard,
  getVehicleDetails,
  getQcReport,
  getVehicleHistory,
  getSuggestedJobs,
  createJobCard,
  getJobCard,
  getVehicleJobCards,
  updateJobCard,
  shareEstimate,
  approveJobCard,
  updateVehicleStatus,
  addServiceHistory,
  requestPartsConfirmation,
  assignTechnician,
  reassignItemTechnician,
  listTechnicians,
  getMyTechnicianJobs,
  startTechnicianWork,
  startItemWork,
  pauseItemWork,
  completeItemWork,
  getTechnicianJobDetail,
  saveDiagnosis,
  uploadItemPhoto,
  deleteItemPhoto,
  requestExtraParts,
  uploadItemSignature,
} from './service';
import { authenticate, checkPermission, checkAnyPermission } from '../../shared/security/auth.middleware';
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

const getVehicleDetailsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getVehicleDetails(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getQcReportHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getQcReport(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getVehicleHistoryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getVehicleHistory(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getSuggestedJobsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getSuggestedJobs(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateVehicleStatusHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateVehicleStatus(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addServiceHistoryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addServiceHistory(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createJobCardHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createJobCard(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getVehicleJobCardsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getVehicleJobCards(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getJobCardHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getJobCard(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateJobCardHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateJobCard(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const requestPartsConfirmationHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await requestPartsConfirmation(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const shareEstimateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await shareEstimate(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const approveJobCardHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await approveJobCard(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const assignTechnicianHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await assignTechnician(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listTechniciansHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listTechnicians(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getMyTechnicianJobsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getMyTechnicianJobs(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const startTechnicianWorkHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await startTechnicianWork(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const itemActionHandler = (fn: (r: FastifyRequest) => Promise<any>) =>
  async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const result = await fn(req);
      const code = (result as any).success?.code || (result as any).error?.code;
      res.status(code).send(result);
    } catch (err) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
    }
  };

// ─── Routes ──────────────────────────────────────────────────────────────────

export const serviceAdvisorRoutes: FastifyPluginAsync = async (app) => {
  // Dashboard
  app.get('/dashboard', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.VIEW)] }, getDashboardHandler);

  // Vehicle details
  app.get('/vehicles/:vehicleId', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.VIEW)] }, getVehicleDetailsHandler);
  app.get('/vehicles/:vehicleId/qc-report', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.VIEW)] }, getQcReportHandler);
  app.get('/vehicles/:vehicleId/history', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.VIEW)] }, getVehicleHistoryHandler);
  app.get('/vehicles/:vehicleId/suggested-jobs', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.VIEW)] }, getSuggestedJobsHandler);

  // Vehicle status
  app.put('/vehicles/:vehicleId/status', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.EDIT)] }, updateVehicleStatusHandler);

  // Vehicle service history
  app.post('/vehicles/:vehicleId/history', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.EDIT)] }, addServiceHistoryHandler);

  // Job cards
  app.post('/vehicles/:vehicleId/job-cards', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.CREATE)] }, createJobCardHandler);
  app.get('/vehicles/:vehicleId/job-cards', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.VIEW)] }, getVehicleJobCardsHandler);
  // Job card detail is readable by Service Advisors (JOB_CARD:view) AND the
  // Foreman (WORKSHOP:view) — the Foreman opens this screen to allocate technicians.
  app.get('/job-cards/:id', { preHandler: [authenticate, checkAnyPermission([MODULES.JOB_CARD, ACTIONS.VIEW], [MODULES.WORKSHOP, ACTIONS.VIEW])] }, getJobCardHandler);
  app.put('/job-cards/:id', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.EDIT)] }, updateJobCardHandler);
  app.post('/job-cards/:id/request-parts', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.EDIT)] }, requestPartsConfirmationHandler);
  app.post('/job-cards/:id/share', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.EDIT)] }, shareEstimateHandler);
  app.post('/job-cards/:id/approve', { preHandler: [authenticate, checkPermission(MODULES.JOB_CARD, ACTIONS.APPROVE)] }, approveJobCardHandler);
  // Technician allocation is a Foreman-only action (client workflow: SA must
  // NOT allocate technicians). Guarded by WORKSHOP:edit, which only the Foreman
  // (and super-admin) holds.
  app.post('/job-cards/:id/assign-technician', { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] }, assignTechnicianHandler);

  // Per-item reassignment — also Foreman-only (WORKSHOP:edit). Service Advisors
  // can no longer reassign technicians.
  app.patch('/items/:itemId/reassign',
    { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] },
    async (req: FastifyRequest, res: FastifyReply) => {
      try {
        const result = await reassignItemTechnician(req);
        const code = (result as any).success?.code || (result as any).error?.code;
        res.status(code).send(result);
      } catch (err) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
      }
    });

  // Technicians list (for the assign modal dropdown)
  // Technicians list is needed by both Service Advisor (assign technician on
  // a job card) AND Foreman (rework reassignment). Accept either permission.
  app.get('/technicians',
    { preHandler: [authenticate, checkAnyPermission([MODULES.JOB_CARD, ACTIONS.VIEW], [MODULES.WORKSHOP, ACTIONS.VIEW])] },
    listTechniciansHandler);

  // Jobs assigned to the currently-logged-in technician (TECHNICIAN module).
  app.get('/technician/my-jobs', { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] }, getMyTechnicianJobsHandler);
  app.post('/technician/jobs/:jobCardId/start', { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] }, startTechnicianWorkHandler);

  // Job-card detail scoped to TECHNICIAN module. Returns the standard job-
  // card payload enriched with per-item time logs + totals.
  app.get(
    '/technician/jobs/:jobCardId',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(getTechnicianJobDetail),
  );

  // Per-item time tracking actions. The actor must be the technician assigned
  // to the item — enforced inside each service function.
  app.post(
    '/technician/items/:itemId/start',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(startItemWork),
  );
  app.post(
    '/technician/items/:itemId/pause',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(pauseItemWork),
  );
  app.post(
    '/technician/items/:itemId/complete',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(completeItemWork),
  );

  // Phase 3 — Diagnosis, photos, signature, mid-repair parts request.
  app.post(
    '/technician/items/:itemId/diagnosis',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(saveDiagnosis),
  );
  app.post(
    '/technician/items/:itemId/photos',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(uploadItemPhoto),
  );
  app.delete(
    '/technician/photos/:photoId',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(deleteItemPhoto),
  );
  app.post(
    '/technician/items/:itemId/signature',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(uploadItemSignature),
  );
  app.post(
    '/technician/items/:itemId/parts-request',
    { preHandler: [authenticate, checkPermission(MODULES.TECHNICIAN, ACTIONS.VIEW)] },
    itemActionHandler(requestExtraParts),
  );
};
