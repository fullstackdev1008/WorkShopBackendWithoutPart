import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getSlotAvailability,
  getBayAvailability,
  getBayAlternatives,
  reallocateAppointmentBay,
  listAppointments,
  getAppointmentById,
  createAppointment,
  updateAppointmentStatus,
  rescheduleAppointment,
  getAppointmentByVehicle,
  linkAppointmentToCheckIn,
  irmCustomerSearch,
  listTodaysAppointmentsForGate,
} from './service';
import { authenticate, checkPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const irmCustomerSearchHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await irmCustomerSearch(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getSlotAvailabilityHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getSlotAvailability(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getBayAvailabilityHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getBayAvailability(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getBayAlternativesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getBayAlternatives(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const reallocateAppointmentBayHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await reallocateAppointmentBay(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listAppointmentsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listAppointments(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listTodaysAppointmentsForGateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listTodaysAppointmentsForGate(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createAppointmentHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createAppointment(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getAppointmentByVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getAppointmentByVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getAppointmentByIdHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getAppointmentById(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateAppointmentStatusHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateAppointmentStatus(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const rescheduleAppointmentHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await rescheduleAppointment(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const linkAppointmentToCheckInHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await linkAppointmentToCheckIn(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const appointmentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/irm-search', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.VIEW)] }, irmCustomerSearchHandler);
  app.get('/slots', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.VIEW)] }, getSlotAvailabilityHandler);
  app.get('/bay-availability', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.VIEW)] }, getBayAvailabilityHandler);
  // Gatekeeper quick-pick list of today's appointments. Uses GATE_ENTRY perm
  // so security staff (who may not have full appointment-module perms) can read it.
  app.get('/today/gate-entry', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, listTodaysAppointmentsForGateHandler);
  app.get('/', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.VIEW)] }, listAppointmentsHandler);
  app.post('/', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.CREATE)] }, createAppointmentHandler);
  app.get('/vehicle/:vehicleId', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, getAppointmentByVehicleHandler);
  app.get('/:id', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.VIEW)] }, getAppointmentByIdHandler);
  app.patch('/:id/status', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.EDIT)] }, updateAppointmentStatusHandler);
  app.patch('/:id/reschedule', { preHandler: [authenticate, checkPermission(MODULES.APPOINTMENT, ACTIONS.EDIT)] }, rescheduleAppointmentHandler);
  // Foreman bay reallocation / displacement swap (Model A) — WORKSHOP:edit.
  app.get('/:id/bay-alternatives', { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] }, getBayAlternativesHandler);
  app.post('/:id/reallocate-bay', { preHandler: [authenticate, checkPermission(MODULES.WORKSHOP, ACTIONS.EDIT)] }, reallocateAppointmentBayHandler);
  app.patch('/:id/check-in', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, linkAppointmentToCheckInHandler);
};
