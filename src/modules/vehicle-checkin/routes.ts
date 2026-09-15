import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listCheckIns,
  getCheckInDetails,
  createCheckIn,
  updateCheckIn,
  deleteCheckIn,
  insertPhoto,
  deletePhoto,
  confirmCheckIn,
} from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listCheckInsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listCheckIns(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getCheckInDetailsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getCheckInDetails(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createCheckInHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createCheckIn(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateCheckInHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateCheckIn(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteCheckInHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteCheckIn(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const insertPhotoHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await insertPhoto(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deletePhotoHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deletePhoto(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const confirmCheckInHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await confirmCheckIn(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const vehicleCheckInRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, listCheckInsHandler);
  app.get('/:id', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, getCheckInDetailsHandler);
  app.post('/', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, createCheckInHandler);
  app.put('/:id', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, updateCheckInHandler);
  app.delete('/:id', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.DELETE)] }, deleteCheckInHandler);
  app.post('/:checkInId/photos', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, insertPhotoHandler);
  app.delete('/:checkInId/photos/:photoId', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, deletePhotoHandler);
  app.post('/:id/confirm', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, confirmCheckInHandler);
};
