import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getDashboard,
  createInspection,
  getInspectionDetails,
  saveStepItems,
  uploadItemPhoto,
  deleteItemPhoto,
  saveFindings,
  saveConfirmation,
  uploadSignature,
  submitInspection,
  getNextVehicle,
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

const getNextVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getNextVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createInspectionHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createInspection(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getInspectionDetailsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getInspectionDetails(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const saveStepItemsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await saveStepItems(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const saveFindingsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await saveFindings(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const saveConfirmationHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await saveConfirmation(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const uploadSignatureHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await uploadSignature(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const submitInspectionHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await submitInspection(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const uploadItemPhotoHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await uploadItemPhoto(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteItemPhotoHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteItemPhoto(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const qcInspectionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dashboard', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.VIEW)] }, getDashboardHandler);
  app.get('/next', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.VIEW)] }, getNextVehicleHandler);
  app.post('/', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.CREATE)] }, createInspectionHandler);
  app.get('/:id', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.VIEW)] }, getInspectionDetailsHandler);
  app.put('/:id/items', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.EDIT)] }, saveStepItemsHandler);
  app.put('/:id/findings', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.EDIT)] }, saveFindingsHandler);
  app.put('/:id/confirmation', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.EDIT)] }, saveConfirmationHandler);
  app.post('/:id/signature', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.EDIT)] }, uploadSignatureHandler);
  app.post('/:id/submit', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.EDIT)] }, submitInspectionHandler);
  app.post('/:inspectionId/items/:itemId/photos', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.EDIT)] }, uploadItemPhotoHandler);
  app.delete('/:inspectionId/items/:itemId/photos/:photoId', { preHandler: [authenticate, checkPermission(MODULES.QC_INSPECTION, ACTIONS.EDIT)] }, deleteItemPhotoHandler);
};
