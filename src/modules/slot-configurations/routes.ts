import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listSlotConfigurations,
  addSlotConfiguration,
  updateSlotConfiguration,
  deleteSlotConfiguration,
} from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listSlotConfigurationsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listSlotConfigurations(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addSlotConfigurationHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addSlotConfiguration(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateSlotConfigurationHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateSlotConfiguration(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteSlotConfigurationHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteSlotConfiguration(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const slotConfigurationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate] }, listSlotConfigurationsHandler);
  app.post('/', { preHandler: [authenticate] }, addSlotConfigurationHandler);
  app.put('/:id', { preHandler: [authenticate] }, updateSlotConfigurationHandler);
  app.delete('/:id', { preHandler: [authenticate] }, deleteSlotConfigurationHandler);
};
