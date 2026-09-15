import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  deleteImage,
  listImages,
  replaceImage,
  uploadImages,
} from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listImagesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listImages(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const uploadImagesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await uploadImages(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const replaceImageHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await replaceImage(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteImageHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteImage(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const vehicleImageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:vehicleId/images', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, listImagesHandler);
  app.post('/:vehicleId/images', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, uploadImagesHandler);
  app.put('/:vehicleId/images/:imageId', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, replaceImageHandler);
  app.delete('/:vehicleId/images/:imageId', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.DELETE)] }, deleteImageHandler);
};
