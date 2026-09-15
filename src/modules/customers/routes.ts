import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerDetails,
  getCustomerVehicles,
  searchCustomers,
  syncCustomerFromIrm,
  lookupCustomerBySequence,
  addCustomerNote,
  getCustomerArAccounts,
} from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const searchCustomersHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await searchCustomers(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getCustomerDetailsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getCustomerDetails(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createCustomerHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createCustomer(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateCustomerHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateCustomer(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteCustomerHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteCustomer(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getCustomerVehiclesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getCustomerVehicles(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const syncCustomerFromIrmHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await syncCustomerFromIrm(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const lookupCustomerBySequenceHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await lookupCustomerBySequence(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addCustomerNoteHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addCustomerNote(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getCustomerArAccountsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getCustomerArAccounts(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', { preHandler: [authenticate] }, searchCustomersHandler);
  app.get('/lookup', { preHandler: [authenticate] }, lookupCustomerBySequenceHandler);
  app.get('/:id', { preHandler: [authenticate] }, getCustomerDetailsHandler);
  app.post('/', { preHandler: [authenticate] }, createCustomerHandler);
  app.put('/:id', { preHandler: [authenticate] }, updateCustomerHandler);
  app.delete('/:id', { preHandler: [authenticate] }, deleteCustomerHandler);
  app.get('/:id/vehicles', { preHandler: [authenticate] }, getCustomerVehiclesHandler);
  app.get('/:id/ar-accounts', { preHandler: [authenticate] }, getCustomerArAccountsHandler);
  app.post('/:id/irm-sync', { preHandler: [authenticate] }, syncCustomerFromIrmHandler);
  app.patch('/:id/notes', { preHandler: [authenticate] }, addCustomerNoteHandler);
};
