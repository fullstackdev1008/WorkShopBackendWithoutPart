import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listServiceTypes,
  addServiceType,
  updateServiceType,
  deleteServiceType,
} from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listServiceTypesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listServiceTypes(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addServiceTypeHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addServiceType(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateServiceTypeHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateServiceType(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteServiceTypeHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteServiceType(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const serviceTypeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate] }, listServiceTypesHandler);
  app.post('/', { preHandler: [authenticate] }, addServiceTypeHandler);
  app.put('/:id', { preHandler: [authenticate] }, updateServiceTypeHandler);
  app.delete('/:id', { preHandler: [authenticate] }, deleteServiceTypeHandler);
};
