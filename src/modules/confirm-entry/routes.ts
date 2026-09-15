import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { confirmVehicleEntry } from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const confirmVehicleEntryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await confirmVehicleEntry(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const confirmEntryRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:vehicleId/confirm', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, confirmVehicleEntryHandler);
};
