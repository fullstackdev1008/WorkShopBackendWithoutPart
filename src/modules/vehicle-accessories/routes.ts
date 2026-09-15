import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listAccessories,
  addAccessory,
  updateAccessory,
  deleteAccessory,
} from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listAccessoriesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listAccessories(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addAccessoryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addAccessory(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateAccessoryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateAccessory(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteAccessoryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteAccessory(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const vehicleAccessoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:vehicleId/accessories', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, listAccessoriesHandler);
  app.post('/:vehicleId/accessories', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, addAccessoryHandler);
  app.put('/:vehicleId/accessories/:id', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, updateAccessoryHandler);
  app.delete('/:vehicleId/accessories/:id', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.DELETE)] }, deleteAccessoryHandler);
};
